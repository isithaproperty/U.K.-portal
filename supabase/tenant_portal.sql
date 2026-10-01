-- Tenant access is assignment-based. The private lookup avoids a policy cycle
-- between blocks and residents without exposing the resident register.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_tenant_of_block(p_block_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.residents r
    where r.block_id = p_block_id
      and r.email = lower(auth.jwt()->>'email')
  );
$$;
revoke all on function private.is_tenant_of_block(bigint) from public, anon;
grant execute on function private.is_tenant_of_block(bigint) to authenticated;
create policy "assigned tenants read their building"
on public.blocks for select to authenticated
using (private.is_tenant_of_block(id));

-- Tenant-facing requests contain no contractor costs or internal work-order notes.
create table public.tenant_requests (
  id bigint generated always as identity primary key,
  block_id bigint not null references public.blocks(id) on delete cascade,
  unit_id bigint not null references public.units(id) on delete cascade,
  resident_id bigint not null references public.residents(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null check (length(trim(description)) between 1 and 5000),
  category text not null default 'General' check (category in ('General','Plumbing','Electrical','Heating','Cleaning','Security','Other')),
  priority text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  status text not null default 'Reported' check (status in ('Reported','In progress','On hold','Complete')),
  manager_reply text not null default '' check (length(manager_reply) <= 5000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenant_requests_resident_idx on public.tenant_requests(resident_id,created_at desc);
create index tenant_requests_block_idx on public.tenant_requests(block_id);
create index tenant_requests_unit_idx on public.tenant_requests(unit_id);
alter table public.tenant_requests enable row level security;
grant select,insert,update on public.tenant_requests to authenticated;
grant usage,select on sequence public.tenant_requests_id_seq to authenticated;
create policy "tenants read their requests" on public.tenant_requests for select to authenticated
using (exists (select 1 from public.residents r where r.id=resident_id and r.unit_id=tenant_requests.unit_id and r.block_id=tenant_requests.block_id and r.email=lower((select auth.jwt()->>'email'))));
create policy "tenants report issues" on public.tenant_requests for insert to authenticated
with check (
 auth.uid() is not null and created_by=lower((select auth.jwt()->>'email'))
 and status='Reported' and manager_reply='' and created_at=now() and updated_at=now()
 and exists (select 1 from public.residents r where r.id=resident_id and r.unit_id=tenant_requests.unit_id and r.block_id=tenant_requests.block_id and r.email=lower((select auth.jwt()->>'email')))
);
create policy "managers read tenant requests" on public.tenant_requests for select to authenticated
using (exists (select 1 from public.portal_members m join public.blocks b on b.id=tenant_requests.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create policy "managers update tenant requests" on public.tenant_requests for update to authenticated
using (exists (select 1 from public.portal_members m join public.blocks b on b.id=tenant_requests.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))))
with check (exists (select 1 from public.portal_members m join public.blocks b on b.id=tenant_requests.block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
-- Only status and the public response are editable after submission.
revoke update on public.tenant_requests from authenticated;
grant update(status,manager_reply,updated_at) on public.tenant_requests to authenticated;
