alter table public.service_charge_entries add column request_id uuid unique;
create or replace function public.assign_service_charge_number() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if nullif(trim(new.reference),'') is null then
  new.reference:=case new.entry_type when 'Charge' then 'INV-' when 'Payment' then 'PAY-' else 'CR-' end||lpad(new.id::text,greatest(8,length(new.id::text)),'0');
 end if;
 return new;
end $$;
revoke all on function public.assign_service_charge_number() from public,anon;
create trigger assign_service_charge_number before insert on public.service_charge_entries for each row execute function public.assign_service_charge_number();
create or replace function public.import_service_charges(p_block_id bigint,p_rows jsonb) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare item jsonb; v_unit_id bigint; v_count integer:=0; v_request_id uuid; v_id bigint; existing public.service_charge_entries%rowtype;
begin
 if not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role in ('owner','admin','manager')) then raise exception 'Manager access required' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Provide 1 to 500 entries'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  select id into v_unit_id from public.units where block_id=p_block_id and unit_number=item->>'unit_number';
  if v_unit_id is null then raise exception 'Unit not found in this block'; end if;
  if nullif(trim(item->>'reference'),'') is null then
   v_request_id:=nullif(item->>'request_id','')::uuid;
   if v_request_id is null then raise exception 'Request ID required for automatic numbering'; end if;
   insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by,request_id)
   values(p_block_id,v_unit_id,item->>'entry_type',trim(item->>'description'),(item->>'amount_pence')::bigint,(item->>'entry_date')::date,nullif(item->>'due_date','')::date,null,lower(auth.jwt()->>'email'),v_request_id)
   on conflict(request_id) do nothing returning id into v_id;
   if v_id is null then
    select * into existing from public.service_charge_entries where request_id=v_request_id;
    if not found or existing.block_id<>p_block_id or existing.unit_id<>v_unit_id or existing.entry_type<>item->>'entry_type' or existing.description<>trim(item->>'description') or existing.amount_pence<>(item->>'amount_pence')::bigint or existing.entry_date<>(item->>'entry_date')::date or existing.due_date is distinct from nullif(item->>'due_date','')::date then raise exception 'Request was already saved with different details'; end if;
   end if;
  else
   insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by)
   values(p_block_id,v_unit_id,item->>'entry_type',trim(item->>'description'),(item->>'amount_pence')::bigint,(item->>'entry_date')::date,nullif(item->>'due_date','')::date,trim(item->>'reference'),lower(auth.jwt()->>'email'))
   on conflict(unit_id,entry_type,reference) do update set description=excluded.description,amount_pence=excluded.amount_pence,entry_date=excluded.entry_date,due_date=excluded.due_date,created_by=excluded.created_by,updated_at=now();
  end if;
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.import_service_charges(bigint,jsonb) from public,anon;
grant execute on function public.import_service_charges(bigint,jsonb) to authenticated;
