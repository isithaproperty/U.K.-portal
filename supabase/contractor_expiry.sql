-- Expiry dates are valid through their stated day in Europe/London.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
alter table public.contractors add column expiry_pause_reason text not null default '';
create or replace function private.contractor_document_key(p_type text) returns text language sql immutable set search_path='' as $$ select case lower(btrim(p_type)) when 'public liability' then 'public liability insurance' when 'employers liability' then 'employers liability insurance' else lower(btrim(p_type)) end; $$;
revoke all on function private.contractor_document_key(text) from public,anon,authenticated;
create or replace function private.contractor_expired_documents(p_id bigint) returns jsonb language sql stable security definer set search_path='' as $$
 with latest as (select distinct on (case lower(btrim(document_type)) when 'public liability' then 'public liability insurance' when 'employers liability' then 'employers liability insurance' else lower(btrim(document_type)) end) id,document_type,expiry_date from public.contractor_documents where contractor_id=p_id order by case lower(btrim(document_type)) when 'public liability' then 'public liability insurance' when 'employers liability' then 'employers liability insurance' else lower(btrim(document_type)) end,uploaded_at desc,id desc)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',document_type,'expiry',expiry_date) order by id),'[]'::jsonb) from latest where expiry_date < (now() at time zone 'Europe/London')::date;
$$;
revoke all on function private.contractor_expired_documents(bigint) from public,anon,authenticated;
create table public.contractor_expiry_notices(id bigint generated always as identity primary key,contractor_id bigint not null references public.contractors(id) on delete cascade,fingerprint text not null,payload jsonb not null,recipient text not null,status text not null default 'Pending' check(status in ('Pending','Processing','Sent','Failed','Cancelled')),attempts integer not null default 0,next_attempt_at timestamptz not null default now(),locked_until timestamptz,sent_at timestamptz,last_error text,created_at timestamptz not null default now(),unique(contractor_id,fingerprint,recipient));
alter table public.contractor_expiry_notices enable row level security;
revoke all on public.contractor_expiry_notices from anon,authenticated;
grant select on public.contractor_expiry_notices to authenticated;
create policy "managers view contractor expiry delivery" on public.contractor_expiry_notices for select to authenticated using(exists(select 1 from public.portal_members m where m.email=lower((select auth.jwt()->>'email')) and m.role in ('owner','admin','manager')));
create index contractor_expiry_retry_idx on public.contractor_expiry_notices(next_attempt_at) where status in ('Pending','Failed','Processing');
create or replace function public.run_contractor_expiry_check() returns integer language plpgsql security definer set search_path='' as $$
declare c record; expired jsonb; paused integer:=0; v_fingerprint text;
begin
 for c in select * from public.contractors where status in ('Approved','Suspended') for update loop
  expired:=private.contractor_expired_documents(c.id);
  if jsonb_array_length(expired)=0 then continue; end if;
  if c.status='Approved' then update public.contractors set status='Suspended',expiry_pause_reason='Expired documents: '||(select string_agg(v->>'type',', ') from jsonb_array_elements(expired) v),updated_at=now() where id=c.id;paused:=paused+1;
  elsif c.expiry_pause_reason='' then continue;end if;
  v_fingerprint:=md5(expired::text);
  if nullif(btrim(c.email),'') is not null then
   insert into public.contractor_members(contractor_id,email) values(c.id,lower(btrim(c.email))) on conflict(contractor_id,email) do nothing;
  end if;
  insert into public.contractor_expiry_notices(contractor_id,fingerprint,recipient,payload)
  select c.id,v_fingerprint,r.email,jsonb_build_object('company',c.company_name,'documents',expired,'contractorEmail',lower(btrim(c.email)),'renewalLink','https://london-property-portal.vercel.app/contractor/renewals/'||c.id,'managerLink','https://london-property-portal.vercel.app/')
  from (select lower(btrim(c.email)) as email where nullif(btrim(c.email),'') is not null
   union select m.email from public.portal_members m where m.role='manager' and exists(select 1 from public.work_orders w join public.blocks b on b.id=w.block_id where w.contractor_id=c.id and b.manager=m.portfolio_manager and w.status<>'Cancelled')
   union select m.email from public.portal_members m where m.email=c.created_by and m.role in ('owner','admin','manager')
  ) r on conflict(contractor_id,fingerprint,recipient) do nothing;
 end loop;return paused;
end $$;
revoke all on function public.run_contractor_expiry_check() from public,anon,authenticated;
grant execute on function public.run_contractor_expiry_check() to service_role;
create or replace function private.guard_contractor_approval() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.status='Approved' then
  if jsonb_array_length(private.contractor_expired_documents(new.id))>0 then raise exception 'Upload current replacement documents before approving this contractor.';end if;
  if old.expiry_pause_reason<>'' and exists(
   select 1 from jsonb_array_elements((select payload->'documents' from public.contractor_expiry_notices where contractor_id=new.id order by id desc limit 1)) required
   where not exists(select 1 from public.contractor_documents d where d.contractor_id=new.id and private.contractor_document_key(d.document_type)=private.contractor_document_key(required->>'type') and d.expiry_date >= (now() at time zone 'Europe/London')::date)
  ) then raise exception 'A current dated replacement is still required for each expired document.';end if;
  new.expiry_pause_reason:='';
 end if;return new;end $$;
revoke all on function private.guard_contractor_approval() from public,anon,authenticated;
create trigger contractor_approval_expiry_guard before update of status on public.contractors for each row execute function private.guard_contractor_approval();
create or replace function private.guard_work_order_contractor() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.contractor_id is not null and (tg_op='INSERT' or new.contractor_id is distinct from old.contractor_id) then
  if not exists(select 1 from public.contractors c where c.id=new.contractor_id and c.status='Approved') or jsonb_array_length(private.contractor_expired_documents(new.contractor_id))>0 then raise exception 'Contractor is paused, not approved, or has expired documents. Choose a current approved contractor.';end if;
 end if;return new;end $$;
revoke all on function private.guard_work_order_contractor() from public,anon,authenticated;
create trigger work_order_contractor_expiry_guard before insert or update of contractor_id on public.work_orders for each row execute function private.guard_work_order_contractor();
-- Service-only validation lets the scheduler token stay inside Vault.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'contractor_expiry_scheduler_token');
create or replace function public.check_contractor_expiry_scheduler(p_token text) returns boolean language sql security definer set search_path='' as $$ select p_token is not null and p_token=(select decrypted_secret from vault.decrypted_secrets where name='contractor_expiry_scheduler_token'); $$;
revoke all on function public.check_contractor_expiry_scheduler(text) from public,anon,authenticated;
grant execute on function public.check_contractor_expiry_scheduler(text) to service_role;
create or replace function public.claim_contractor_expiry_notices(p_limit integer default 20) returns setof public.contractor_expiry_notices language sql security definer set search_path='' as $$
 update public.contractor_expiry_notices n set status='Processing',attempts=attempts+1,locked_until=now()+interval '15 minutes'
 where id in(select id from public.contractor_expiry_notices where ((status in ('Pending','Failed') and next_attempt_at<=now()) or (status='Processing' and locked_until<now())) order by id for update skip locked limit least(greatest(p_limit,1),20)) returning n.*;
$$;
revoke all on function public.claim_contractor_expiry_notices(integer) from public,anon,authenticated;
grant execute on function public.claim_contractor_expiry_notices(integer) to service_role;
-- Pausing runs in the database even when email is unavailable.
select cron.schedule('contractor-document-expiry','5 * * * *',$job$
 select public.run_contractor_expiry_check();
 select net.http_post(url:='https://yhyqxvbquavhndxcwttt.supabase.co/functions/v1/contractor-expiry',headers:=jsonb_build_object('Content-Type','application/json','x-scheduler-token',(select decrypted_secret from vault.decrypted_secrets where name='contractor_expiry_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=60000);
$job$);

create or replace function public.current_contractor_expired_documents(p_id bigint) returns jsonb language sql stable security definer set search_path='' as $$ select private.contractor_expired_documents(p_id); $$;
revoke all on function public.current_contractor_expired_documents(bigint) from public,anon,authenticated;
grant execute on function public.current_contractor_expired_documents(bigint) to service_role;

create or replace function private.guard_contractor_document_date() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.expiry_date is null and exists(select 1 from public.contractor_documents d where d.contractor_id=new.contractor_id and private.contractor_document_key(d.document_type)=private.contractor_document_key(new.document_type) and d.expiry_date is not null) then raise exception 'Enter an expiry date for this replacement document.';end if;
 new.uploaded_at:=now();return new;end $$;
revoke all on function private.guard_contractor_document_date() from public,anon,authenticated;
create trigger contractor_document_renewal_date_guard before insert on public.contractor_documents for each row execute function private.guard_contractor_document_date();
