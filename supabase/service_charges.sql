create table public.service_charge_entries(
 id bigint generated always as identity primary key,
 block_id bigint not null references public.blocks(id) on delete cascade,
 unit_id bigint not null references public.units(id) on delete cascade,
 entry_type text not null check(entry_type in ('Charge','Payment','Credit')),
 description text not null check(length(trim(description)) between 1 and 300),
 amount_pence bigint not null check(amount_pence between 1 and 100000000),
 entry_date date not null,
 due_date date,
 reference text not null check(length(trim(reference)) between 1 and 100),
 created_by text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(unit_id,entry_type,reference),
 check((entry_type='Charge' and due_date is not null and due_date>=entry_date) or (entry_type<>'Charge' and due_date is null))
);
create index service_charge_entries_block_idx on public.service_charge_entries(block_id);
alter table public.service_charge_entries enable row level security;
grant select,insert,update on public.service_charge_entries to authenticated;
grant usage,select on sequence public.service_charge_entries_id_seq to authenticated;
create policy "residents read unit charges" on public.service_charge_entries for select to authenticated
using(exists(select 1 from public.residents r where r.unit_id=service_charge_entries.unit_id and r.block_id=service_charge_entries.block_id and r.email=lower((select auth.jwt()->>'email'))));
create policy "managers read unit charges" on public.service_charge_entries for select to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=service_charge_entries.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create policy "managers add unit charges" on public.service_charge_entries for insert to authenticated
with check(created_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.units u join public.blocks b on b.id=u.block_id join public.portal_members m on m.email=lower((select auth.jwt()->>'email')) where u.id=service_charge_entries.unit_id and u.block_id=service_charge_entries.block_id and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create policy "managers correct unit charges" on public.service_charge_entries for update to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=service_charge_entries.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))))
with check(created_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.units u join public.blocks b on b.id=u.block_id join public.portal_members m on m.email=lower((select auth.jwt()->>'email')) where u.id=service_charge_entries.unit_id and u.block_id=service_charge_entries.block_id and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create or replace function public.import_service_charges(p_block_id bigint,p_rows jsonb) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare item jsonb; v_unit_id bigint; v_count integer:=0;
begin
 if not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role in ('owner','admin','manager')) then raise exception 'Manager access required' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Provide 1 to 500 entries'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  select id into v_unit_id from public.units where block_id=p_block_id and unit_number=item->>'unit_number';
  if v_unit_id is null then raise exception 'Unit not found in this block'; end if;
  insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by)
  values(p_block_id,v_unit_id,item->>'entry_type',trim(item->>'description'),(item->>'amount_pence')::bigint,(item->>'entry_date')::date,nullif(item->>'due_date','')::date,trim(item->>'reference'),lower(auth.jwt()->>'email'))
  on conflict(unit_id,entry_type,reference) do update set description=excluded.description,amount_pence=excluded.amount_pence,entry_date=excluded.entry_date,due_date=excluded.due_date,created_by=excluded.created_by,updated_at=now();
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.import_service_charges(bigint,jsonb) from public,anon;
grant execute on function public.import_service_charges(bigint,jsonb) to authenticated;
