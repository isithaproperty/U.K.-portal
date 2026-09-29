-- Apply to the dedicated London Property Portal Supabase project.
create table if not exists public.portal_members (
  email text primary key,
  role text not null check (role in ('owner','manager')),
  created_at timestamptz not null default now(),
  constraint portal_members_lower_email check (email = lower(email))
);

create table if not exists public.blocks (
  id bigint generated always as identity primary key,
  source_row integer not null unique,
  name text not null,
  management_company text not null,
  type text not null,
  address text not null,
  units integer not null check (units >= 0),
  manager text not null,
  financial_year_end date not null,
  myblockman_export_enabled boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_blocks_name on public.blocks (name);

alter table public.portal_members enable row level security;
alter table public.blocks enable row level security;

revoke all on public.portal_members from anon, authenticated;
revoke all on public.blocks from anon, authenticated;
grant select on public.portal_members to authenticated;
grant select on public.blocks to authenticated;

drop policy if exists "members can read own membership" on public.portal_members;
create policy "members can read own membership"
on public.portal_members for select to authenticated
using (email = lower((select auth.jwt() ->> 'email')));

drop policy if exists "members can read blocks" on public.blocks;
create policy "members can read blocks"
on public.blocks for select to authenticated
using (
  exists (
    select 1 from public.portal_members
    where email = lower((select auth.jwt() ->> 'email'))
  )
);

-- Grant initial membership separately in the private seed. Sign-up alone
-- never grants access.
