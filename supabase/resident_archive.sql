alter table public.residents add column archived_at timestamptz;
alter table public.residents drop constraint residents_unit_id_email_key;
create unique index residents_active_unit_email_idx on public.residents(unit_id,email) where archived_at is null;
create index residents_archive_idx on public.residents(block_id,archived_at);
create or replace function private.is_tenant_of_block(p_block_id bigint) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and exists(select 1 from public.residents r where r.block_id=p_block_id and r.archived_at is null and r.email=lower(auth.jwt()->>'email')); $$;
-- Remove former occupants from every existing tenant ownership predicate.
do $$ declare p record; begin
 for p in select * from pg_policies where schemaname='public' and (coalesce(qual,'') like '%residents r%' or coalesce(with_check,'') like '%residents r%') loop
  if p.qual is not null then execute format('alter policy %I on public.%I using (%s)',p.policyname,p.tablename,replace(p.qual,'r.email','r.archived_at is null and r.email'));end if;
  if p.with_check is not null then execute format('alter policy %I on public.%I with check (%s)',p.policyname,p.tablename,replace(p.with_check,'r.email','r.archived_at is null and r.email'));end if;
 end loop;
end $$;
alter policy "portfolio scoped resident read" on public.residents using((archived_at is null and email=lower((select auth.jwt()->>'email'))) or exists(select 1 from public.portal_members m join public.blocks b on b.id=residents.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role='owner' or (m.role='manager' and m.portfolio_manager=b.manager))));
-- A delayed communications save must not publish to an archived resident.
create or replace function private.publish_resident_communications() returns trigger language plpgsql set search_path='' as $$ begin if new.status='sent' then insert into public.resident_messages(communication_id,resident_id,block_id,recipient_email,subject,message,sent_at) select new.id,r.id,s.block_id,lower(s.email),new.subject,new.message,new.created_at from jsonb_to_recordset(new.recipient_snapshot) as s(resident_id bigint,block_id bigint,email text) join public.residents r on r.id=s.resident_id and r.block_id=s.block_id and r.email=lower(s.email) and r.archived_at is null where s.block_id=any(new.block_ids) on conflict(communication_id,resident_id) do nothing;end if;return new;end $$;

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
   on conflict(unit_id,email) where archived_at is null do update set full_name=excluded.full_name,phone=excluded.phone;
  end if;
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
