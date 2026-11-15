-- London management-company client invoices only. No resident/supplier ledger integration.
-- Review and test locally. Do not apply to production without separate approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.client_invoices(
 id uuid primary key,
 block_id bigint not null references public.blocks(id),
 block_snapshot jsonb not null,
 status text not null check(status in ('Draft','Reviewed','Issued','Voided')),
 invoice_number text unique,
 revision bigint not null check(revision>0),
 document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=100000),
 net_pence bigint not null check(net_pence>=0),vat_pence bigint not null check(vat_pence>=0),total_pence bigint not null check(total_pence=net_pence+vat_pence and total_pence<=1000000000000),
 created_by text not null,created_at timestamptz not null default now(),updated_by text not null,updated_at timestamptz not null default now(),
 reviewed_by text,reviewed_at timestamptz,issued_by text,issued_at timestamptz,voided_by text,voided_at timestamptz,void_reason text,
 check((status in ('Draft','Reviewed') and invoice_number is null and issued_at is null) or (status in ('Issued','Voided') and invoice_number is not null and issued_at is not null)),
 check(status='Draft' or (reviewed_by is not null and reviewed_at is not null)),
 check(status<>'Voided' or (voided_by is not null and voided_at is not null and length(btrim(void_reason))>=5))
);
create index client_invoice_block_updated_idx on public.client_invoices(block_id,updated_at desc,id);
create table public.client_invoice_events(
 id bigint generated always as identity primary key,
 invoice_id uuid not null references public.client_invoices(id),revision bigint not null,
 action text not null check(action in ('Save','Review','Issue','Void')),actor text not null,actor_id uuid not null,occurred_at timestamptz not null default now(),
 request_id uuid not null unique,request_payload jsonb not null,snapshot jsonb not null,
 unique(invoice_id,revision)
);
create sequence private.client_invoice_number_seq;
create table private.client_invoice_configuration(singleton boolean primary key default true check(singleton),writes_enabled boolean not null default false,issuing_enabled boolean not null default false,check(not issuing_enabled or writes_enabled));
insert into private.client_invoice_configuration(singleton,writes_enabled,issuing_enabled) values(true,false,false);
alter table private.client_invoice_configuration enable row level security;
revoke all on private.client_invoice_configuration from public,anon,authenticated,service_role;
revoke all on sequence private.client_invoice_number_seq,public.client_invoice_events_id_seq from public,anon,authenticated,service_role;

create function private.client_invoice_can_manage(p_block bigint,p_approve boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (not p_approve and m.role='manager' and length(btrim(m.portfolio_manager))>0 and m.portfolio_manager=b.manager)));
$$;
revoke all on function private.client_invoice_can_manage(bigint,boolean) from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.client_invoice_can_manage(bigint,boolean) to authenticated;
alter table public.client_invoices enable row level security;
alter table public.client_invoice_events enable row level security;
revoke all on public.client_invoices,public.client_invoice_events from public,anon,authenticated,service_role;
grant select on public.client_invoices,public.client_invoice_events to authenticated;
create policy "scoped managers read client invoices" on public.client_invoices for select to authenticated using(private.client_invoice_can_manage(block_id));
create policy "scoped managers read client invoice audit" on public.client_invoice_events for select to authenticated using(exists(select 1 from public.client_invoices i where i.id=invoice_id and private.client_invoice_can_manage(i.block_id)));

create function private.client_invoice_keys(p jsonb,keys text[]) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object' and p ?& keys and p-keys='{}'::jsonb,false);
$$;
create function private.client_invoice_pdf_text(p text) returns void language plpgsql immutable set search_path='' as $$
begin
 if p ~ E'[^\t\r\n -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]' then raise exception 'PDF text supports Western European characters; review unsupported text before issue';end if;
end $$;
create function private.client_invoice_label(p jsonb,k text,max_length integer,required boolean,pdf_ready boolean) returns text
language plpgsql immutable set search_path='' as $$
declare v text;canonical text;
begin
 if jsonb_typeof(p->k) is distinct from 'string' then raise exception 'Invoice text field missing: %',k;end if;
 v:=p->>k;canonical:=btrim(v,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
 if length(v)>max_length or v<>canonical or v~'[[:cntrl:]]' and regexp_replace(v,E'[\t\r\n]','','g')~'[[:cntrl:]]' or (required and length(canonical)=0) then raise exception 'Invalid invoice text: %',k;end if;
 if pdf_ready then perform private.client_invoice_pdf_text(v);end if;
 return v;
end $$;
create function private.validate_client_invoice_document(p jsonb,ready boolean) returns jsonb
language plpgsql immutable set search_path='' as $$
declare line jsonb;party jsonb;k text;v text;registered boolean;q bigint;price bigint;rate bigint;net bigint;vat bigint;total_net bigint:=0;total_vat bigint:=0;seen uuid[]:='{}';line_id uuid;dates text[]:='{}';whitespace text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if not private.client_invoice_keys(p,array['version','currency','issuer','client','periodStart','periodEnd','invoiceDate','dueDate','reference','paymentInstructions','notes','lines']) or p->'version' is distinct from '1'::jsonb or p->>'currency' is distinct from 'GBP' or octet_length(p::text)>100000 then raise exception 'Invalid GBP client invoice document';end if;
 if not private.client_invoice_keys(p->'issuer',array['name','address','email','companyNumber','vatRegistered','vatNumber']) or not private.client_invoice_keys(p->'client',array['name','address','email']) or jsonb_typeof(p#>'{issuer,vatRegistered}') is distinct from 'boolean' then raise exception 'Explicit issuer, client and VAT configuration required';end if;
 registered:=(p#>>'{issuer,vatRegistered}')::boolean;
 for party in select p->'issuer' union all select p->'client' loop
  perform private.client_invoice_label(party,'name',200,ready,ready);perform private.client_invoice_label(party,'address',1000,ready,ready);
  v:=private.client_invoice_label(party,'email',200,false,ready);if v<>'' and v !~ ('^[^'||whitespace||'@]+@[^'||whitespace||'@]+\.[^'||whitespace||'@]+$') then raise exception 'Invalid invoice contact email';end if;
 end loop;
 perform private.client_invoice_label(p->'issuer','companyNumber',100,false,ready);
 v:=private.client_invoice_label(p->'issuer','vatNumber',100,ready and registered,ready);
 if not registered and v<>'' then raise exception 'VAT number requires explicit registration';end if;
 foreach k in array array['reference','paymentInstructions','notes'] loop perform private.client_invoice_label(p,k,case when k='reference' then 200 else 2000 end,false,ready);end loop;
 foreach k in array array['periodStart','periodEnd','invoiceDate','dueDate'] loop
  v:=private.client_invoice_label(p,k,10,ready,false);
  if v<>'' and (v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(v::date,'YYYY-MM-DD')<>v) then raise exception 'Invalid client invoice date';end if;
  dates:=array_append(dates,v);
 end loop;
 if dates[1]<>'' and dates[2]<>'' and dates[2]<dates[1] or dates[3]<>'' and dates[4]<>'' and dates[4]<dates[3] then raise exception 'Invoice dates must be in order';end if;
 if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines')>50 or ready and jsonb_array_length(p->'lines')<1 then raise exception 'Choose up to 50 invoice lines';end if;
 for line in select value from jsonb_array_elements(p->'lines') loop
  if not private.client_invoice_keys(line,array['id','description','quantityMilli','unitPricePence','vatRateBps']) then raise exception 'Invalid invoice line';end if;
  if jsonb_typeof(line->'id') is distinct from 'string' or (line->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Use a canonical invoice line UUID';end if;
  line_id:=(line->>'id')::uuid;if line_id is null or line_id=any(seen) then raise exception 'Invoice lines need unique identifiers';end if;seen:=array_append(seen,line_id);
  perform private.client_invoice_label(line,'description',500,ready,ready);
  foreach k in array array['quantityMilli','unitPricePence','vatRateBps'] loop if jsonb_typeof(line->k) is distinct from 'number' or (line->>k)!~'^[0-9]+$' then raise exception 'Invoice amounts must be nonnegative integers';end if;end loop;
  q:=(line->>'quantityMilli')::bigint;price:=(line->>'unitPricePence')::bigint;rate:=(line->>'vatRateBps')::bigint;
  if q>1000000 or price>100000000 or rate>10000 or (ready and (q=0 or price=0)) or (not registered and rate<>0) then raise exception 'Invalid quantity, price or unconfigured VAT';end if;
  net:=(q*price+500)/1000;vat:=(net*rate+5000)/10000;total_net:=total_net+net;total_vat:=total_vat+vat;
 end loop;
 if total_net+total_vat>1000000000000 or ready and total_net+total_vat<=0 then raise exception 'Unsupported invoice total';end if;
 return jsonb_build_object('net',total_net,'vat',total_vat,'total',total_net+total_vat);
end $$;
revoke all on function private.client_invoice_pdf_text(text),private.client_invoice_keys(jsonb,text[]),private.client_invoice_label(jsonb,text,integer,boolean,boolean),private.validate_client_invoice_document(jsonb,boolean) from public,anon,authenticated,service_role;

-- Narrow authorized capability: callers have no direct write privilege on invoices, audit or numbering.
create function private.mutate_client_invoice(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ident uuid;req_id uuid;block bigint;expected bigint;action_name text;actor_email text;current_row public.client_invoices%rowtype;next_row public.client_invoices%rowtype;prior public.client_invoice_events%rowtype;totals jsonb;block_info jsonb;number_value text;reason text;writes_allowed boolean;issue_allowed boolean;
begin
 if auth.uid() is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>110000 then raise exception 'Sign in and provide a bounded invoice request' using errcode='42501';end if;
 if not p ?& array['id','requestId','blockId','expectedRevision','action'] or p-array['id','requestId','blockId','expectedRevision','action','document','confirmed','reason']<>'{}'::jsonb then raise exception 'Invalid invoice request';end if;
 if jsonb_typeof(p->'blockId') is distinct from 'number' or (p->>'blockId')!~'^[0-9]+$' or jsonb_typeof(p->'expectedRevision') is distinct from 'number' or (p->>'expectedRevision')!~'^[0-9]+$' then raise exception 'Use whole block and revision identifiers';end if;
 if jsonb_typeof(p->'id') is distinct from 'string' or (p->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(p->'requestId') is distinct from 'string' or (p->>'requestId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Use canonical invoice and request UUIDs';end if;
 ident:=(p->>'id')::uuid;req_id:=(p->>'requestId')::uuid;block:=(p->>'blockId')::bigint;expected:=(p->>'expectedRevision')::bigint;action_name:=p->>'action';actor_email:=lower(auth.jwt()->>'email');
 if ident is null or req_id is null or block is null or expected is null or expected<0 or expected>9007199254740991 or action_name not in ('Save','Review','Issue','Void') or action_name is null then raise exception 'Invalid invoice identity, revision or action';end if;
 if not private.client_invoice_can_manage(block,false) then raise exception 'Manager block access required' using errcode='42501';end if;
 if action_name<>'Save' and (p->'confirmed' is distinct from 'true'::jsonb or not private.client_invoice_can_manage(block,true)) then raise exception 'Owner or admin confirmation required' using errcode='42501';end if;
 -- A shared row lock makes a committed master-disable wait for every in-flight mutation.
 select writes_enabled,issuing_enabled into writes_allowed,issue_allowed from private.client_invoice_configuration where singleton for share;
 if not coalesce(writes_allowed,false) then raise exception 'Client invoice writes have not been activated';end if;
 perform pg_advisory_xact_lock(hashtextextended('client-invoice:'||ident::text,0));
 select * into current_row from public.client_invoices where id=ident for update;
 if found and current_row.block_id<>block then raise exception 'Invoice access denied' using errcode='42501';end if;
 select * into prior from public.client_invoice_events where request_id=req_id;
 if found then
  if prior.invoice_id<>ident or prior.request_payload<>p then raise exception 'Request identifier belongs to another action' using errcode='23505';end if;
  return jsonb_build_object('invoice',to_jsonb(current_row),'replayed',true);
 end if;
 if coalesce(current_row.revision,0)<>expected then raise exception 'Saved invoice changed; reload before acting' using errcode='40001';end if;
 if action_name='Save' then
  if current_row.id is not null and current_row.status not in ('Draft','Reviewed') then raise exception 'Issued and voided invoices are immutable';end if;
  totals:=private.validate_client_invoice_document(p->'document',false);
  select jsonb_build_object('name',coalesce(b.name,''),'address',coalesce(b.address,'')) into block_info from public.blocks b where b.id=block;
  if current_row.id is null then
   insert into public.client_invoices(id,block_id,block_snapshot,status,revision,document,net_pence,vat_pence,total_pence,created_by,updated_by)
   values(ident,block,block_info,'Draft',1,p->'document',(totals->>'net')::bigint,(totals->>'vat')::bigint,(totals->>'total')::bigint,actor_email,actor_email) returning * into next_row;
  else
   update public.client_invoices set document=p->'document',block_snapshot=block_info,status='Draft',revision=revision+1,net_pence=(totals->>'net')::bigint,vat_pence=(totals->>'vat')::bigint,total_pence=(totals->>'total')::bigint,reviewed_by=null,reviewed_at=null,updated_by=actor_email,updated_at=clock_timestamp() where id=ident returning * into next_row;
  end if;
 elsif action_name='Review' then
  if current_row.status is distinct from 'Draft' then raise exception 'Review a saved draft first';end if;
  totals:=private.validate_client_invoice_document(current_row.document,true);
  perform private.client_invoice_pdf_text(current_row.block_snapshot->>'name');perform private.client_invoice_pdf_text(current_row.block_snapshot->>'address');
  update public.client_invoices set status='Reviewed',reviewed_by=actor_email,reviewed_at=clock_timestamp(),updated_by=actor_email,updated_at=clock_timestamp(),revision=revision+1 where id=ident returning * into next_row;
 elsif action_name='Issue' then
  if current_row.status is distinct from 'Reviewed' then raise exception 'Review this exact saved revision before issue';end if;
  if not coalesce(issue_allowed,false) then raise exception 'Client invoice issuing has not been activated';end if;
  totals:=private.validate_client_invoice_document(current_row.document,true);
  perform private.client_invoice_pdf_text(current_row.block_snapshot->>'name');perform private.client_invoice_pdf_text(current_row.block_snapshot->>'address');
  if (current_row.document->>'invoiceDate')::date>(clock_timestamp() at time zone 'Europe/London')::date then raise exception 'Future-dated invoices cannot be issued yet';end if;
  number_value:=nextval('private.client_invoice_number_seq')::text;number_value:='MCI-'||lpad(number_value,greatest(8,length(number_value)),'0');
  update public.client_invoices set status='Issued',invoice_number=number_value,issued_by=actor_email,issued_at=clock_timestamp(),updated_by=actor_email,updated_at=clock_timestamp(),revision=revision+1 where id=ident returning * into next_row;
 else
  if current_row.status is distinct from 'Issued' then raise exception 'Only an issued invoice may be voided';end if;
  reason:=private.client_invoice_label(p,'reason',1000,true,true);if length(reason)<5 then raise exception 'Record a clear void reason';end if;
  update public.client_invoices set status='Voided',void_reason=reason,voided_by=actor_email,voided_at=clock_timestamp(),updated_by=actor_email,updated_at=clock_timestamp(),revision=revision+1 where id=ident returning * into next_row;
 end if;
 insert into public.client_invoice_events(invoice_id,revision,action,actor,actor_id,request_id,request_payload,snapshot) values(ident,next_row.revision,action_name,actor_email,auth.uid(),req_id,p,to_jsonb(next_row));
 return jsonb_build_object('invoice',to_jsonb(next_row),'replayed',false);
end $$;
revoke all on function private.mutate_client_invoice(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.mutate_client_invoice(jsonb) to authenticated;
create function public.mutate_client_invoice(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.mutate_client_invoice(p_request);$$;
revoke all on function public.mutate_client_invoice(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mutate_client_invoice(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
