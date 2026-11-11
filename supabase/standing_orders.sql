-- Review migration only. Apply after automatic_invoice_numbers.sql and bank_reconciliation.sql.
create unique index if not exists standing_order_unit_scope_idx on public.units(id,block_id);
create unique index if not exists standing_order_ledger_scope_idx on public.service_charge_entries(id,block_id);
create unique index if not exists standing_order_bank_scope_idx on public.bank_statement_rows(id,block_id);
create table public.standing_orders(
 id bigint generated always as identity primary key,
 block_id bigint not null references public.blocks(id),
 unit_id bigint not null unique references public.units(id),
 amount_pence bigint not null check(amount_pence between 1 and 100000000),
 start_date date not null check(start_date>='2000-01-01'),
 cadence text not null check(cadence in ('annual','half_yearly','quarterly','english_quarterly')),
 due_offset_days integer not null default 0 check(due_offset_days between 0 and 365),
 invoice_mode text not null default 'invoice_review' check(invoice_mode in ('invoice_review','auto_invoice')),
 allocation_mode text not null default 'allocation_review' check(allocation_mode in ('allocation_review','auto_exact_match')),
 enabled boolean not null default false,
 lease_confirmed boolean not null default false,
 lease_reference text not null default '' check(length(lease_reference)<=300),
 confirmed_by text not null,
 updated_at timestamptz not null default now(),
 revision integer not null default 1 check(revision>0),
 check(not enabled or (lease_confirmed and length(trim(lease_reference))>0)),
 check(cadence<>'english_quarterly' or to_char(start_date,'MM-DD') in ('03-25','06-24','09-29','12-25')),
 unique(id,block_id),
 foreign key(unit_id,block_id) references public.units(id,block_id)
);
create index standing_orders_block_enabled_idx on public.standing_orders(block_id,enabled);
create table public.standing_order_runs(
 id bigint generated always as identity primary key,
 order_id bigint not null references public.standing_orders(id),
 block_id bigint not null references public.blocks(id),
 occurrence_date date not null,
 action text not null check(action in ('Invoice prepared','Invoice posted','Payment allocated')),
 ledger_entry_id bigint references public.service_charge_entries(id),
 bank_row_id bigint references public.bank_statement_rows(id),
 snapshot jsonb not null,
 created_by text not null,
 created_at timestamptz not null default now(),
 unique(bank_row_id),
 check((action='Invoice prepared' and ledger_entry_id is null and bank_row_id is null) or (action='Invoice posted' and ledger_entry_id is not null and bank_row_id is null) or (action='Payment allocated' and ledger_entry_id is not null and bank_row_id is not null)),
 foreign key(order_id,block_id) references public.standing_orders(id,block_id),
 foreign key(ledger_entry_id,block_id) references public.service_charge_entries(id,block_id),
 foreign key(bank_row_id,block_id) references public.bank_statement_rows(id,block_id)
);
create unique index standing_order_invoice_occurrence_idx on public.standing_order_runs(order_id,occurrence_date) where action in ('Invoice prepared','Invoice posted');
alter table public.standing_orders enable row level security;
alter table public.standing_order_runs enable row level security;
revoke all on public.standing_orders,public.standing_order_runs from public,anon,authenticated;
grant select,insert,update on public.standing_orders to authenticated;
grant select,insert on public.standing_order_runs to authenticated;
grant all on public.standing_orders,public.standing_order_runs to service_role;
grant usage,select on sequence public.standing_orders_id_seq,public.standing_order_runs_id_seq to authenticated,service_role;
-- Do not rely on platform default privileges for the server-side scheduler.
grant usage on schema public,auth to service_role;
grant select on public.portal_members,public.blocks,public.units to service_role;
grant select,insert on public.service_charge_entries to service_role;
grant select,update on public.bank_statement_rows to service_role;
grant usage,select on sequence public.service_charge_entries_id_seq to service_role;
create policy "scoped managers maintain standing orders" on public.standing_orders for all to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=standing_orders.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))))
with check(confirmed_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.units u join public.blocks b on b.id=u.block_id join public.portal_members m on m.email=lower((select auth.jwt()->>'email')) where u.id=standing_orders.unit_id and u.block_id=standing_orders.block_id and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create policy "scoped managers read standing order runs" on public.standing_order_runs for select to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=standing_order_runs.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create policy "scoped managers record standing order runs" on public.standing_order_runs for insert to authenticated
with check(created_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.standing_orders s join public.blocks b on b.id=s.block_id join public.portal_members m on m.email=lower((select auth.jwt()->>'email')) where s.id=standing_order_runs.order_id and s.block_id=standing_order_runs.block_id and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)) and (standing_order_runs.action='Invoice prepared' or exists(select 1 from public.service_charge_entries e where e.id=standing_order_runs.ledger_entry_id and e.block_id=s.block_id and e.unit_id=s.unit_id and ((standing_order_runs.action='Invoice posted' and e.entry_type='Charge') or (standing_order_runs.action='Payment allocated' and e.entry_type='Payment' and exists(select 1 from public.bank_statement_rows r where r.id=standing_order_runs.bank_row_id and r.block_id=s.block_id and r.unit_id=s.unit_id and r.status='Posted' and r.payment_entry_id=e.id)))))));

create or replace function public.save_standing_order(p_block_id bigint,p_config jsonb,p_revision integer) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.standing_orders%rowtype;v_unit bigint:=(p_config->>'unitId')::bigint;
begin
 if p_revision is null or p_revision<0 then raise exception 'Valid revision required';end if;
 if not exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then raise exception 'Manager block access required' using errcode='42501'; end if;
 if not exists(select 1 from public.units where id=v_unit and block_id=p_block_id) then raise exception 'Unit not in block';end if;
 perform pg_advisory_xact_lock(hashtextextended('standing-order:'||v_unit,0));
 select * into v from public.standing_orders where unit_id=v_unit for update;
 if (found and (v.block_id<>p_block_id or v.revision<>p_revision)) or (not found and p_revision<>0) then raise exception 'Standing-order revision conflict' using errcode='40001';end if;
 insert into public.standing_orders(block_id,unit_id,amount_pence,start_date,cadence,due_offset_days,invoice_mode,allocation_mode,enabled,lease_confirmed,lease_reference,confirmed_by)
 values(p_block_id,v_unit,(p_config->>'amountPence')::bigint,(p_config->>'startDate')::date,p_config->>'cadence',(p_config->>'dueOffsetDays')::integer,p_config->>'invoiceMode',p_config->>'allocationMode',(p_config->>'enabled')::boolean,(p_config->>'leaseConfirmed')::boolean,trim(p_config->>'leaseReference'),lower(auth.jwt()->>'email'))
 on conflict(unit_id) do update set amount_pence=excluded.amount_pence,start_date=excluded.start_date,cadence=excluded.cadence,due_offset_days=excluded.due_offset_days,invoice_mode=excluded.invoice_mode,allocation_mode=excluded.allocation_mode,enabled=excluded.enabled,lease_confirmed=excluded.lease_confirmed,lease_reference=excluded.lease_reference,confirmed_by=excluded.confirmed_by,updated_at=now(),revision=standing_orders.revision+1
 returning * into v;
 return to_jsonb(v);
end $$;

-- The scheduler uses service_role; a scoped manager may also run the same processor.
-- No SECURITY DEFINER: normal calls retain RLS; service calls must explicitly pass the role guard.
create or replace function public.process_standing_orders(p_block_id bigint,p_today date default (now() at time zone 'Europe/London')::date) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.standing_orders%rowtype;bankrow public.bank_statement_rows%rowtype;v_date date;v_due date;v_actor text;v_id bigint;v_request uuid;v_year integer;v_q integer;v_index integer;v_step integer;v_matches integer;v_prepared integer:=0;v_invoices integer:=0;v_payments integer:=0;v_service boolean:=coalesce(auth.jwt()->>'role','')='service_role';v_description text;
begin
 if p_today is null or p_today>(now() at time zone 'Europe/London')::date then raise exception 'Processing date cannot be in the future';end if;
 if not v_service and not exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then raise exception 'Manager block access required' using errcode='42501';end if;
 for s in select * from public.standing_orders where block_id=p_block_id and enabled and lease_confirmed and start_date<=p_today order by id for update loop
  -- Re-check the approving manager has not lost authority since configuration was saved.
  if not exists(select 1 from public.portal_members m join public.blocks b on b.id=s.block_id where m.email=s.confirmed_by and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then continue;end if;
  v_actor:=case when v_service then s.confirmed_by else lower(auth.jwt()->>'email') end;
  -- Reject excessive history explicitly rather than silently stopping at period 500.
  if s.cadence='english_quarterly' then
   v_q:=case extract(month from s.start_date)::integer when 3 then 0 when 6 then 1 when 9 then 2 else 3 end+500;
   v_year:=extract(year from s.start_date)::integer+v_q/4;
   v_date:=case v_q%4 when 0 then make_date(v_year,3,25) when 1 then make_date(v_year,6,24) when 2 then make_date(v_year,9,29) else make_date(v_year,12,25) end;
  else
   v_step:=case s.cadence when 'annual' then 12 when 'half_yearly' then 6 else 3 end;
   v_date:=(s.start_date+make_interval(months=>v_step*500))::date;
  end if;
  if v_date<=p_today then raise exception 'Standing order % exceeds 500 historical periods. Review and narrow its effective start date before processing.',s.id;end if;
  for v_index in 0..499 loop
   if s.cadence='english_quarterly' then
    v_q:=case extract(month from s.start_date)::integer when 3 then 0 when 6 then 1 when 9 then 2 else 3 end+v_index;
    v_year:=extract(year from s.start_date)::integer+v_q/4;
    v_date:=case v_q%4 when 0 then make_date(v_year,3,25) when 1 then make_date(v_year,6,24) when 2 then make_date(v_year,9,29) else make_date(v_year,12,25) end;
   else
    v_step:=case s.cadence when 'annual' then 12 when 'half_yearly' then 6 else 3 end;
    v_date:=(s.start_date+make_interval(months=>v_step*v_index))::date;
   end if;
   exit when v_date>p_today;
   v_due:=v_date+s.due_offset_days;
   if exists(select 1 from public.standing_order_runs where order_id=s.id and occurrence_date=v_date and action in ('Invoice prepared','Invoice posted')) then continue;end if;
   if s.invoice_mode='invoice_review' then
    insert into public.standing_order_runs(order_id,block_id,occurrence_date,action,snapshot,created_by) values(s.id,s.block_id,v_date,'Invoice prepared',jsonb_build_object('amountPence',s.amount_pence,'issueDate',v_date,'dueDate',v_due,'unitId',s.unit_id,'leaseReference',s.lease_reference,'revision',s.revision),v_actor) on conflict do nothing;
    v_prepared:=v_prepared+1;
   else
    v_request:=md5('standing-order:'||s.id||':'||v_date)::uuid;
    v_description:='Standing-order lease schedule · '||left(s.lease_reference,200);
    insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by,request_id) values(s.block_id,s.unit_id,'Charge',v_description,s.amount_pence,v_date,v_due,null,v_actor,v_request) on conflict(request_id) do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.service_charge_entries where request_id=v_request and block_id=s.block_id and unit_id=s.unit_id and entry_type='Charge' and amount_pence=s.amount_pence and entry_date=v_date and due_date=v_due; if not found then raise exception 'Existing standing-order invoice has conflicting details';end if;end if;
    insert into public.standing_order_runs(order_id,block_id,occurrence_date,action,ledger_entry_id,snapshot,created_by) values(s.id,s.block_id,v_date,'Invoice posted',v_id,jsonb_build_object('amountPence',s.amount_pence,'issueDate',v_date,'dueDate',v_due,'unitId',s.unit_id,'leaseReference',s.lease_reference,'revision',s.revision),v_actor) on conflict do nothing;
    v_invoices:=v_invoices+1;
   end if;
  end loop;
  if s.allocation_mode='auto_exact_match' then
   for bankrow in select r.* from public.bank_statement_rows r join public.units u on u.id=s.unit_id and u.block_id=s.block_id where r.block_id=s.block_id and r.status='Pending' and r.amount_pence=s.amount_pence and r.transaction_date between s.start_date and p_today and u.payment_reference is not null and upper(regexp_replace(r.bank_reference,'\s','','g'))=upper(regexp_replace(u.payment_reference,'\s','','g')) order by r.id for update of r loop
    select count(*) into v_matches from public.units u where u.block_id=s.block_id and u.payment_reference is not null and upper(regexp_replace(u.payment_reference,'\s','','g'))=upper(regexp_replace(bankrow.bank_reference,'\s','','g'));
    if v_matches<>1 then continue;end if;
    -- Genuine imported bank receipt only. BANK:<id> and row locks match post_bank_payments.
    insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by) values(s.block_id,s.unit_id,'Payment',left(coalesce(nullif(bankrow.description,''),'Bank transfer')||' · '||bankrow.bank_reference,300),bankrow.amount_pence,bankrow.transaction_date,null,'BANK:'||bankrow.id,v_actor) returning id into v_id;
    update public.bank_statement_rows set status='Posted',unit_id=s.unit_id,payment_entry_id=v_id,posted_at=now() where id=bankrow.id;
    insert into public.standing_order_runs(order_id,block_id,occurrence_date,action,ledger_entry_id,bank_row_id,snapshot,created_by) values(s.id,s.block_id,bankrow.transaction_date,'Payment allocated',v_id,bankrow.id,jsonb_build_object('bankRowId',bankrow.id,'amountPence',bankrow.amount_pence,'unitId',s.unit_id),v_actor);
    v_payments:=v_payments+1;
   end loop;
  end if;
 end loop;
 return jsonb_build_object('prepared',v_prepared,'invoices',v_invoices,'payments',v_payments);
end $$;
revoke all on function public.save_standing_order(bigint,jsonb,integer),public.process_standing_orders(bigint,date) from public,anon;
grant execute on function public.save_standing_order(bigint,jsonb,integer) to authenticated;
grant execute on function public.process_standing_orders(bigint,date) to authenticated,service_role;
