-- Apply after schema.sql to an existing London Property Portal project.
create table if not exists public.units (
  id bigint generated always as identity primary key,
  block_id bigint not null references public.blocks(id) on delete cascade,
  unit_number text not null check (length(trim(unit_number)) > 0),
  created_at timestamptz not null default now(),
  unique (block_id, unit_number),
  unique (id, block_id)
);

create table if not exists public.residents (
  id bigint generated always as identity primary key,
  unit_id bigint not null,
  block_id bigint not null,
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null check (email = lower(email)),
  phone text,
  created_at timestamptz not null default now(),
  foreign key (unit_id, block_id) references public.units(id, block_id) on delete cascade,
  unique (unit_id, email)
);
create index if not exists idx_residents_email on public.residents(email);
create index if not exists idx_residents_block on public.residents(block_id);
create index if not exists idx_units_block on public.units(block_id);

alter table public.units enable row level security;
alter table public.residents enable row level security;
revoke all on public.units from anon, authenticated;
revoke all on public.residents from anon, authenticated;
grant select, insert, update on public.units to authenticated;
grant select, insert, update on public.residents to authenticated;

drop policy if exists "members can read blocks" on public.blocks;
create policy "members and assigned residents can read blocks"
on public.blocks for select to authenticated
using (
  exists (select 1 from public.portal_members m
          where m.email = lower((select auth.jwt() ->> 'email'))
            and m.role in ('owner', 'manager'))
  or exists (select 1 from public.residents r
             where r.block_id = blocks.id
               and r.email = lower((select auth.jwt() ->> 'email')))
);

create policy "managers and assigned residents can read units"
on public.units for select to authenticated
using (
  exists (select 1 from public.portal_members m
          where m.email = lower((select auth.jwt() ->> 'email'))
            and m.role in ('owner', 'manager'))
  or exists (select 1 from public.residents r
             where r.unit_id = units.id
               and r.email = lower((select auth.jwt() ->> 'email')))
);

create policy "managers and residents can read resident records"
on public.residents for select to authenticated
using (
  email = lower((select auth.jwt() ->> 'email'))
  or exists (select 1 from public.portal_members m
             where m.email = lower((select auth.jwt() ->> 'email'))
               and m.role in ('owner', 'manager'))
);

create policy "managers can add units"
on public.units for insert to authenticated
with check (exists (select 1 from public.portal_members m
                    where m.email = lower((select auth.jwt() ->> 'email'))
                      and m.role in ('owner', 'manager')));
create policy "managers can edit units"
on public.units for update to authenticated
using (exists (select 1 from public.portal_members m
               where m.email = lower((select auth.jwt() ->> 'email'))
                 and m.role in ('owner', 'manager')))
with check (exists (select 1 from public.portal_members m
                    where m.email = lower((select auth.jwt() ->> 'email'))
                      and m.role in ('owner', 'manager')));

create policy "managers can add residents"
on public.residents for insert to authenticated
with check (exists (select 1 from public.portal_members m
                    where m.email = lower((select auth.jwt() ->> 'email'))
                      and m.role in ('owner', 'manager')));
create policy "managers can edit residents"
on public.residents for update to authenticated
using (exists (select 1 from public.portal_members m
               where m.email = lower((select auth.jwt() ->> 'email'))
                 and m.role in ('owner', 'manager')))
with check (exists (select 1 from public.portal_members m
                    where m.email = lower((select auth.jwt() ->> 'email'))
                      and m.role in ('owner', 'manager')));

-- The import is one transaction: a rejected resident row never leaves a
-- partial set of units behind. It runs with the caller's RLS permissions.
create or replace function public.import_block_residents(
  p_block_id bigint, p_rows jsonb
) returns integer
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_unit_id bigint;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.portal_members m
    where m.email = lower(auth.jwt() ->> 'email')
      and m.role in ('owner', 'manager')
  ) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 500 then
    raise exception 'Provide between 1 and 500 rows';
  end if;
  perform 1 from public.blocks where id = p_block_id;
  if not found then raise exception 'Block not found'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if length(trim(coalesce(item->>'unit_number', ''))) = 0 then
      raise exception 'Unit number is required';
    end if;
    insert into public.units(block_id, unit_number)
    values (p_block_id, trim(item->>'unit_number'))
    on conflict (block_id, unit_number) do update
      set unit_number = excluded.unit_number
    returning id into v_unit_id;

    if nullif(trim(coalesce(item->>'resident_email', '')), '') is not null then
      if length(trim(coalesce(item->>'resident_name', ''))) = 0 then
        raise exception 'Resident name is required when email is set';
      end if;
      insert into public.residents(unit_id, block_id, full_name, email, phone)
      values (v_unit_id, p_block_id, trim(item->>'resident_name'),
              lower(trim(item->>'resident_email')),
              nullif(trim(coalesce(item->>'phone', '')), ''))
      on conflict (unit_id, email) do update
        set full_name = excluded.full_name, phone = excluded.phone;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.import_block_residents(bigint, jsonb) from public, anon;
grant execute on function public.import_block_residents(bigint, jsonb) to authenticated;
