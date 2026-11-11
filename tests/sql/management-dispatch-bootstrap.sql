do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end $$;
grant usage on schema auth to service_role;grant execute on all functions in schema auth to service_role;
create table public.communications(id bigint generated always as identity primary key);
