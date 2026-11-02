-- Run only inside an empty, disposable Postgres database. Synthetic fixtures only.
create role anon nologin;create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
grant usage on schema auth to anon,authenticated;
grant execute on all functions in schema auth to anon,authenticated;
create table public.portal_members(email text primary key,role text,portfolio_manager text);
create table public.blocks(id bigint primary key,manager text);
insert into public.portal_members values('manager@example.invalid','manager','London'),('other@example.invalid','manager','Other'),('owner@example.invalid','owner',null),('tenant@example.invalid','resident',null);
insert into public.blocks values(1,'London'),(2,'Other');
alter table public.portal_members enable row level security;
alter table public.blocks enable row level security;
grant select on public.portal_members,public.blocks to authenticated;
create policy members_self on public.portal_members for select to authenticated using(email=auth.jwt()->>'email');
-- Deliberately broader block readability to prove review policy separately scopes managers.
create policy readable_blocks on public.blocks for select to authenticated using(true);
