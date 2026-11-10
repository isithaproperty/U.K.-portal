-- Apply only after review. Cash observations are not resident payments or supplier settlements.
create table public.building_cashflow_rows (
 id bigint generated always as identity primary key,
 block_id bigint not null references public.blocks(id) on delete cascade,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 transaction_date date not null,
 amount_pence bigint not null check(amount_pence between -100000000 and 100000000 and amount_pence <> 0),
 bank_reference text not null default '' check(length(bank_reference)<=500),
 description text not null default '' check(length(description)<=1000),
 transaction_id text not null default '' check(length(transaction_id)<=200),
 source_file text not null check(length(source_file) between 1 and 200),
 status text not null default 'Unreconciled' check(status='Unreconciled'),
 imported_by text not null,
 imported_at timestamptz not null default now(),
 unique(block_id,fingerprint)
);
create index building_cashflow_rows_block_date_idx on public.building_cashflow_rows(block_id,transaction_date,id);
alter table public.building_cashflow_rows enable row level security;
revoke all on public.building_cashflow_rows from public,anon,authenticated;
grant select,insert on public.building_cashflow_rows to authenticated;
revoke all on sequence public.building_cashflow_rows_id_seq from public,anon,authenticated;
grant usage,select on sequence public.building_cashflow_rows_id_seq to authenticated;
create policy "scoped managers read cash observations" on public.building_cashflow_rows for select to authenticated
using(exists(select 1 from public.portal_members m join public.blocks b on b.id=building_cashflow_rows.block_id
 where m.email=lower((select auth.jwt()->>'email')) and
 (m.role in ('owner','admin') or (m.role='manager' and nullif(m.portfolio_manager,'') is not null and m.portfolio_manager=b.manager))));
create policy "scoped managers stage cash observations" on public.building_cashflow_rows for insert to authenticated
with check(imported_by=lower((select auth.jwt()->>'email')) and exists(select 1 from public.portal_members m join public.blocks b on b.id=building_cashflow_rows.block_id
 where m.email=lower((select auth.jwt()->>'email')) and
 (m.role in ('owner','admin') or (m.role='manager' and nullif(m.portfolio_manager,'') is not null and m.portfolio_manager=b.manager))));

create or replace function public.stage_building_cashflow(p_block_id bigint,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; v_id bigint; added integer:=0; duplicates integer:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id
  where m.email=lower(auth.jwt()->>'email') and
  (m.role in ('owner','admin') or (m.role='manager' and nullif(m.portfolio_manager,'') is not null and m.portfolio_manager=b.manager))) then
  raise exception 'Manager access to this building required' using errcode='42501';
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Provide 1 to 1000 cash observations';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid cash observation';end if;
  insert into public.building_cashflow_rows(block_id,fingerprint,transaction_date,amount_pence,bank_reference,description,transaction_id,source_file,imported_by)
  values(p_block_id,item->>'fingerprint',(item->>'transaction_date')::date,(item->>'amount_pence')::bigint,
   item->>'bank_reference',item->>'description',item->>'transaction_id',item->>'source_file',lower(auth.jwt()->>'email'))
  on conflict(block_id,fingerprint) do nothing returning id into v_id;
  if v_id is null then
   if exists(select 1 from public.building_cashflow_rows r where r.block_id=p_block_id and r.fingerprint=item->>'fingerprint'
    and (r.transaction_date<>(item->>'transaction_date')::date or r.amount_pence<>(item->>'amount_pence')::bigint)) then
    raise exception 'Existing bank transaction has a different date or signed amount';
   end if;
   duplicates:=duplicates+1;
  else added:=added+1;end if;
 end loop;
 return jsonb_build_object('added',added,'duplicates',duplicates);
end $$;
revoke all on function public.stage_building_cashflow(bigint,jsonb) from public,anon;
grant execute on function public.stage_building_cashflow(bigint,jsonb) to authenticated;
-- No UPDATE, DELETE, resident SELECT, or financial-posting function is granted by this migration.
