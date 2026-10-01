alter table public.units add column payment_reference text check(payment_reference is null or length(payment_reference) between 1 and 80);
create unique index units_block_payment_reference_idx on public.units(block_id,upper(regexp_replace(payment_reference,'\s','','g'))) where payment_reference is not null;
create or replace function public.import_block_residents(p_block_id bigint,p_rows jsonb) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare item jsonb; v_unit_id bigint; v_count integer:=0; v_ref text;
begin
 if not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role in ('owner','admin','manager')) then raise exception 'Manager access required' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Provide 1 to 500 rows'; end if;
 perform 1 from public.blocks where id=p_block_id; if not found then raise exception 'Block unavailable'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if length(trim(coalesce(item->>'unit_number',''))) not between 1 and 80 then raise exception 'Unit number required'; end if;
  v_ref:=nullif(upper(regexp_replace(trim(coalesce(item->>'payment_reference','')),'\s','','g')),'');
  if v_ref is not null and (length(v_ref)>80 or v_ref !~ '^[A-Z0-9][A-Z0-9/._-]*$') then raise exception 'Invalid payment reference'; end if;
  insert into public.units(block_id,unit_number,payment_reference) values(p_block_id,trim(item->>'unit_number'),v_ref)
  on conflict(block_id,unit_number) do update set payment_reference=coalesce(excluded.payment_reference,units.payment_reference) returning id into v_unit_id;
  if nullif(trim(coalesce(item->>'resident_email','')),'') is not null then
   if length(trim(coalesce(item->>'resident_name','')))=0 then raise exception 'Resident name required'; end if;
   insert into public.residents(unit_id,block_id,full_name,email,phone) values(v_unit_id,p_block_id,trim(item->>'resident_name'),lower(trim(item->>'resident_email')),nullif(trim(coalesce(item->>'phone','')),''))
   on conflict(unit_id,email) do update set full_name=excluded.full_name,phone=excluded.phone;
  end if;
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.import_block_residents(bigint,jsonb) from public,anon;
grant execute on function public.import_block_residents(bigint,jsonb) to authenticated;
create table public.bank_statement_rows(
 id bigint generated always as identity primary key,
 block_id bigint not null references public.blocks(id) on delete cascade,
 fingerprint text not null check(length(fingerprint)=64),
 transaction_date date not null,
 amount_pence bigint not null check(amount_pence between 1 and 100000000),
 bank_reference text not null default '' check(length(bank_reference)<=500),
 description text not null default '' check(length(description)<=1000),
 transaction_id text not null default '' check(length(transaction_id)<=200),
 source_file text not null check(length(source_file)<=200),
 status text not null default 'Pending' check(status in ('Pending','Posted','Ignored')),
 unit_id bigint references public.units(id),
 payment_entry_id bigint unique references public.service_charge_entries(id),
 imported_by text not null,
 imported_at timestamptz not null default now(),
 posted_at timestamptz,
 unique(block_id,fingerprint),
 check((status='Posted' and unit_id is not null and payment_entry_id is not null and posted_at is not null) or (status<>'Posted' and unit_id is null and payment_entry_id is null and posted_at is null))
);
create index bank_statement_rows_block_status_idx on public.bank_statement_rows(block_id,status,id);
alter table public.bank_statement_rows enable row level security;
grant select,insert,update on public.bank_statement_rows to authenticated;
grant usage,select on sequence public.bank_statement_rows_id_seq to authenticated;
create policy "managers read and maintain bank rows" on public.bank_statement_rows for all to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=bank_statement_rows.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))))
with check(exists(select 1 from public.portal_members m join public.blocks b on b.id=bank_statement_rows.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create or replace function public.stage_bank_statement(p_block_id bigint,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare item jsonb; v_id bigint; added integer:=0; duplicates integer:=0;
begin
 if not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role in ('owner','admin','manager')) then raise exception 'Manager access required' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Provide 1 to 1000 rows'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  insert into public.bank_statement_rows(block_id,fingerprint,transaction_date,amount_pence,bank_reference,description,transaction_id,source_file,imported_by)
  values(p_block_id,item->>'fingerprint',(item->>'transaction_date')::date,(item->>'amount_pence')::bigint,item->>'bank_reference',item->>'description',item->>'transaction_id',item->>'source_file',lower(auth.jwt()->>'email'))
  on conflict(block_id,fingerprint) do nothing returning id into v_id;
  if v_id is null then
   if exists(select 1 from public.bank_statement_rows r where r.block_id=p_block_id and r.fingerprint=item->>'fingerprint' and (r.transaction_date<>(item->>'transaction_date')::date or r.amount_pence<>(item->>'amount_pence')::bigint)) then raise exception 'Duplicate transaction ID has different amount or date'; end if;
   duplicates:=duplicates+1;
  else added:=added+1; end if;
 end loop;
 return jsonb_build_object('added',added,'duplicates',duplicates);
end $$;
create or replace function public.post_bank_payments(p_block_id bigint,p_assignments jsonb) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare item jsonb; bankrow public.bank_statement_rows%rowtype; payment_id bigint; v_unit_id bigint; posted integer:=0;
begin
 if not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role in ('owner','admin','manager')) then raise exception 'Manager access required' using errcode='42501'; end if;
 if jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments) not between 1 and 1000 then raise exception 'Provide 1 to 1000 payments'; end if;
 for item in select value from jsonb_array_elements(p_assignments) order by (value->>'id')::bigint loop
  select * into bankrow from public.bank_statement_rows where id=(item->>'id')::bigint and block_id=p_block_id for update;
  if not found then raise exception 'Statement payment unavailable'; end if;
  if bankrow.status='Posted' then continue; end if;
  if bankrow.status<>'Pending' then raise exception 'Only pending payments may be posted'; end if;
  v_unit_id:=(item->>'unit_id')::bigint;
  if not exists(select 1 from public.units where id=v_unit_id and block_id=p_block_id) then raise exception 'Unit belongs to another block'; end if;
  insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by)
  values(p_block_id,v_unit_id,'Payment',left(coalesce(nullif(bankrow.description,''),'Bank transfer')||' · '||bankrow.bank_reference,300),bankrow.amount_pence,bankrow.transaction_date,null,'BANK:'||bankrow.id,lower(auth.jwt()->>'email')) returning id into payment_id;
  update public.bank_statement_rows set status='Posted',unit_id=v_unit_id,payment_entry_id=payment_id,posted_at=now() where id=bankrow.id;
  posted:=posted+1;
 end loop;
 return posted;
end $$;
revoke all on function public.stage_bank_statement(bigint,jsonb),public.post_bank_payments(bigint,jsonb) from public,anon;
grant execute on function public.stage_bank_statement(bigint,jsonb),public.post_bank_payments(bigint,jsonb) to authenticated;
