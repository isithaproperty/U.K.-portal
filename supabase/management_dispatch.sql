-- Review only; after management_review.sql. Delivery workers remain disabled by default.
create table public.management_dispatches(
 idempotency_key text primary key check(length(idempotency_key) between 20 and 100),
 block_id bigint not null references public.blocks(id),unit_id bigint references public.units(id),
 operation_id text not null,kind text not null check(kind in ('Demand','Credit note','First reminder','Final reminder','Section20')),
 recipient text not null,envelope jsonb not null,scheduled_at timestamptz not null,
 status text not null default 'Pending' check(status in ('Pending','Sending','Sent','Failed','Uncertain','Cancelled')),
 approved_by text not null,approved_at timestamptz not null default now(),
 attempt_count integer not null default 0,claim_token uuid,claimed_at timestamptz,
 sent_at timestamptz,provider_message_id text,delivery_status text not null default 'Not established' check(delivery_status in ('Not established','Provider accepted','Delivered','Bounced')),
 delivered_at timestamptz,error_message text,
 unique nulls not distinct(block_id,operation_id,unit_id,recipient,kind),
 check(jsonb_typeof(envelope)='object' and octet_length(envelope::text)<=3500000),
 check(envelope->>'idempotencyKey'=idempotency_key and (envelope->>'blockId')::bigint=block_id and envelope->>'to'=recipient and envelope->>'kind'=kind and envelope->>'operationId'=operation_id),
 check((envelope->>'unitId')::bigint is not distinct from unit_id),
 check(kind='Section20' or unit_id is not null)
);
create index management_dispatch_due_idx on public.management_dispatches(scheduled_at,idempotency_key) where status='Pending';
create index management_dispatch_unit_idx on public.management_dispatches(block_id,unit_id,sent_at);
create table public.management_dispatch_events(
 id bigint generated always as identity primary key,dispatch_key text not null references public.management_dispatches(idempotency_key),
 block_id bigint not null references public.blocks(id),at timestamptz not null default now(),event text not null,detail jsonb not null
);
create index management_dispatch_event_idx on public.management_dispatch_events(dispatch_key,id);
alter table public.management_dispatches enable row level security;
alter table public.management_dispatch_events enable row level security;
revoke all on public.management_dispatches,public.management_dispatch_events from public,anon,authenticated;
grant select on public.management_dispatches to authenticated;
grant select on public.management_dispatch_events to authenticated;
grant all on public.management_dispatches,public.management_dispatch_events to service_role;
grant usage,select on sequence public.management_dispatch_events_id_seq to service_role;
create policy "scoped managers see dispatches" on public.management_dispatches for select to authenticated using(exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create or replace function public.management_dispatch_recipient_allowed(p_block bigint,p_unit bigint,p_kind text,p_email text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.management_review_state s cross join lateral jsonb_array_elements(s.state->'contacts') c cross join lateral jsonb_array_elements_text(c->'emails') email where s.block_id=p_block and s.area='leaseholders' and c->>'blockId'=p_block::text and email=p_email and (p_unit is null or c->>'unitId'=p_unit::text) and ((p_kind='Section20' and c->>'role' in ('Leaseholder','Recognised association')) or (p_kind<>'Section20' and c->>'role'='Leaseholder' and c->>'demands'='true')))
$$;
revoke all on function public.management_dispatch_recipient_allowed(bigint,bigint,text,text) from public,anon;
grant execute on function public.management_dispatch_recipient_allowed(bigint,bigint,text,text) to authenticated,service_role;
create policy "scoped managers queue approved exact recipients" on public.management_dispatches for insert to authenticated with check(
 approved_by=lower((select auth.jwt()->>'email')) and status='Pending' and attempt_count=0 and claim_token is null and claimed_at is null and sent_at is null and provider_message_id is null and delivery_status='Not established' and delivered_at is null
 and (unit_id is null or exists(select 1 from public.units u where u.id=unit_id and u.block_id=management_dispatches.block_id))
 and public.management_dispatch_recipient_allowed(block_id,unit_id,kind,recipient)
 and exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))
);
create policy "scoped managers see dispatch events" on public.management_dispatch_events for select to authenticated using(exists(select 1 from public.management_dispatches d where d.idempotency_key=dispatch_key));
-- Audit insertion is driven by the service worker. Queue approval itself is retained in the immutable row.
create or replace function public.claim_management_dispatches(p_at timestamptz,p_block_id bigint default null)
 returns setof public.management_dispatches language plpgsql security invoker set search_path='' as $$
declare row public.management_dispatches%rowtype;
begin
 -- A crashed submission is uncertain, never automatically retried.
 for row in update public.management_dispatches set status='Uncertain',error_message='Worker lease expired; reconcile provider acceptance before retrying' where status='Sending' and claimed_at<p_at-interval '15 minutes' and (p_block_id is null or block_id=p_block_id) returning * loop
  insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(row.idempotency_key,row.block_id,'Uncertain',jsonb_build_object('reason',row.error_message));
 end loop;
 for row in select d.* from public.management_dispatches d where d.status='Pending' and d.scheduled_at<=p_at and (p_block_id is null or d.block_id=p_block_id) order by d.scheduled_at,d.idempotency_key for update skip locked limit 1 loop
  perform 1 from public.management_review_state where block_id=row.block_id and area in ('financials','debtors','leaseholders') for share;
  if exists(select 1 from (values ('financials',row.envelope #>> '{sourceEvidence,financialRevision}'),('debtors',row.envelope #>> '{sourceEvidence,reminderRevision}'),('leaseholders',row.envelope #>> '{sourceEvidence,consultationRevision}'),('leaseholders',row.envelope #>> '{sourceEvidence,contactRevision}')) expected(area,revision) where expected.revision is not null and not exists(select 1 from public.management_review_state s where s.block_id=row.block_id and s.area=expected.area and s.revision::text=expected.revision)) or not public.management_dispatch_recipient_allowed(row.block_id,row.unit_id,row.kind,row.recipient) or not exists(select 1 from public.portal_members m join public.blocks b on b.id=row.block_id where m.email=row.approved_by and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then
   update public.management_dispatches set status='Failed',error_message='Saved source, recipient assignment or approving manager scope changed; review required' where idempotency_key=row.idempotency_key;
   insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(row.idempotency_key,row.block_id,'Approval invalidated','{}');continue;
  end if;
  update public.management_dispatches set status='Sending',claim_token=gen_random_uuid(),claimed_at=p_at,attempt_count=attempt_count+1 where idempotency_key=row.idempotency_key returning * into row;
  insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(row.idempotency_key,row.block_id,'Sending',jsonb_build_object('attempt',row.attempt_count));
  return next row;
 end loop;
end $$;
create or replace function public.finish_management_dispatch(p_key text,p_token uuid,p_status text,p_provider_id text,p_evidence text)
 returns void language plpgsql security invoker set search_path='' as $$
declare row public.management_dispatches%rowtype;
begin
 if p_status not in ('Sent','Failed','Uncertain') or nullif(btrim(p_evidence),'') is null then raise exception 'Valid submission evidence required';end if;
 if p_status='Sent' and nullif(btrim(p_provider_id),'') is null then raise exception 'Provider identifier required';end if;
 update public.management_dispatches set status=p_status,provider_message_id=p_provider_id,sent_at=case when p_status='Sent' then clock_timestamp() else null end,delivery_status=case when p_status='Sent' then 'Provider accepted' else 'Not established' end,error_message=left(p_evidence,5000)
 where idempotency_key=p_key and claim_token=p_token and status='Sending' returning * into row;
 if not found then raise exception 'Claim no longer active' using errcode='40001';end if;
 insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(row.idempotency_key,row.block_id,p_status,jsonb_build_object('providerId',p_provider_id,'evidence',left(p_evidence,5000)));
 if p_status='Sent' then perform public.apply_management_delivery_events(p_provider_id);end if;
end $$;
revoke all on function public.claim_management_dispatches(timestamptz,bigint),public.finish_management_dispatch(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_management_dispatches(timestamptz,bigint),public.finish_management_dispatch(text,uuid,text,text,text) to service_role;
create or replace function public.queue_management_dispatches(p_rows jsonb,p_actor text) returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb;existing public.management_dispatches%rowtype;n integer:=0;
begin
 if nullif(btrim(p_actor),'') is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Provide an approved dispatch batch';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if not exists(select 1 from public.portal_members m join public.blocks b on b.id=(item->>'block_id')::bigint where m.email=p_actor and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) or not public.management_dispatch_recipient_allowed((item->>'block_id')::bigint,(item->>'unit_id')::bigint,item->>'kind',item->>'recipient') then raise exception 'Verified manager and current recipient required' using errcode='42501';end if;
  if (item->>'unit_id') is not null and not exists(select 1 from public.units where id=(item->>'unit_id')::bigint and block_id=(item->>'block_id')::bigint) then raise exception 'Unit outside block';end if;
  insert into public.management_dispatches(idempotency_key,block_id,unit_id,operation_id,kind,recipient,envelope,scheduled_at,approved_by)
  values(item->>'idempotency_key',(item->>'block_id')::bigint,(item->>'unit_id')::bigint,item->>'operation_id',item->>'kind',item->>'recipient',item->'envelope',(item->>'scheduled_at')::timestamptz,p_actor) on conflict(idempotency_key) do nothing;
  if not found then
   select * into existing from public.management_dispatches where idempotency_key=item->>'idempotency_key';
   if not found or existing.envelope is distinct from item->'envelope' then raise exception 'Dispatch retry differs from saved snapshot';end if;
  end if;n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.queue_management_dispatches(jsonb,text) from public,anon,authenticated;
grant execute on function public.queue_management_dispatches(jsonb,text) to service_role;
create or replace function public.reconcile_management_dispatch(p_key text,p_action text,p_actor text,p_evidence text,p_provider_id text default null) returns void language plpgsql security invoker set search_path='' as $$
declare row public.management_dispatches%rowtype;next_status text;
begin
 select * into row from public.management_dispatches where idempotency_key=p_key for update;
 if not found or not exists(select 1 from public.portal_members m join public.blocks b on b.id=row.block_id where m.email=p_actor and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then raise exception 'Manager scope required' using errcode='42501';end if;
 if length(btrim(coalesce(p_evidence,'')))<10 then raise exception 'Authoritative reconciliation evidence required';end if;
 if p_action='Cancel' and row.status in ('Pending','Failed') then next_status:='Cancelled';
 elsif p_action='Retry' and row.status='Failed' then next_status:='Pending';
 elsif p_action='Reconcile not accepted' and row.status='Uncertain' then next_status:='Failed';
 elsif p_action='Reconcile accepted' and row.status='Uncertain' and nullif(btrim(p_provider_id),'') is not null then next_status:='Sent';
 else raise exception 'Invalid dispatch transition; uncertain sends cannot be blindly retried';end if;
 update public.management_dispatches set status=next_status,provider_message_id=case when next_status='Sent' then p_provider_id else provider_message_id end,sent_at=case when next_status='Sent' then clock_timestamp() else sent_at end,delivery_status=case when next_status='Sent' then 'Provider accepted' else delivery_status end,error_message=left(p_evidence,5000) where idempotency_key=p_key;
 insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(row.idempotency_key,row.block_id,p_action,jsonb_build_object('actor',p_actor,'evidence',left(p_evidence,5000),'providerId',p_provider_id));
end $$;
revoke all on function public.reconcile_management_dispatch(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_management_dispatch(text,text,text,text,text) to service_role;
create or replace function public.protect_management_dispatch_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.envelope is distinct from old.envelope or new.block_id<>old.block_id or new.unit_id is distinct from old.unit_id or new.kind<>old.kind or new.operation_id<>old.operation_id or new.recipient<>old.recipient or new.scheduled_at<>old.scheduled_at or new.approved_by<>old.approved_by or new.approved_at<>old.approved_at then raise exception 'Approved delivery snapshots are immutable';end if;return new;
end $$;
revoke all on function public.protect_management_dispatch_snapshot() from public,anon,authenticated;
create trigger protect_management_dispatch_snapshot before update on public.management_dispatches for each row execute function public.protect_management_dispatch_snapshot();
create table public.management_manager_alerts(
 block_id bigint not null references public.blocks(id),consultation_id text not null,review_date date not null,
 snapshot jsonb not null,created_at timestamptz not null default now(),primary key(block_id,consultation_id,review_date)
);
alter table public.management_manager_alerts enable row level security;
revoke all on public.management_manager_alerts from public,anon,authenticated;
grant select on public.management_manager_alerts to authenticated;
grant all on public.management_manager_alerts to service_role;
create policy "scoped manager consultation alerts" on public.management_manager_alerts for select to authenticated using(exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
create or replace function public.create_management_review_alerts(p_today date) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_today is null or p_today>(now() at time zone 'Europe/London')::date then raise exception 'Cannot process future review alerts';end if;
 insert into public.management_manager_alerts(block_id,consultation_id,review_date,snapshot)
 select s.block_id,c->>'id',(c->>'basisDate')::date+30,c from public.management_review_state s cross join lateral jsonb_array_elements(s.state->'consultations') c where s.area='leaseholders' and c->>'confirmed'='true' and c->>'basisDate'~'^\d{4}-\d{2}-\d{2}$' and (c->>'basisDate')::date+30<=p_today on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.create_management_review_alerts(date) from public,anon,authenticated;
grant execute on function public.create_management_review_alerts(date) to service_role;
grant select on public.management_review_state,public.management_review_history,public.blocks,public.portal_members,public.units to service_role;
-- Postgres requires UPDATE privilege on at least one column for a row share lock.
grant update(revision) on public.management_review_state to service_role;
alter table public.management_dispatch_events add column provider_event_id text unique;
create or replace function public.record_management_delivery_event(p_event_id text,p_provider_id text,p_event text,p_at timestamptz) returns boolean language plpgsql security invoker set search_path='' as $$
declare row public.management_dispatches%rowtype;
begin
 if nullif(btrim(p_event_id),'') is null or p_event not in ('email.delivered','email.bounced') or p_at is null then raise exception 'Invalid delivery event';end if;
 if exists(select 1 from public.management_dispatch_events where provider_event_id=p_event_id) then return false;end if;
 select * into row from public.management_dispatches where provider_message_id=p_provider_id and status='Sent' for update;
 if not found then return false;end if;
 insert into public.management_dispatch_events(dispatch_key,block_id,at,event,detail,provider_event_id) values(row.idempotency_key,row.block_id,p_at,p_event,jsonb_build_object('providerId',p_provider_id),p_event_id) on conflict(provider_event_id) do nothing;
 if not found then return false;end if;
 if row.delivery_status='Provider accepted' then update public.management_dispatches set delivery_status=case when p_event='email.delivered' then 'Delivered' else 'Bounced' end,delivered_at=case when p_event='email.delivered' then p_at else null end where idempotency_key=row.idempotency_key;end if;
 return true;
end $$;
revoke all on function public.record_management_delivery_event(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_management_delivery_event(text,text,text,timestamptz) to service_role;
create unique index management_dispatch_provider_unique on public.management_dispatches(provider_message_id) where provider_message_id is not null;
-- Verified provider events are durably reserved even if they beat submission persistence.
create table public.management_delivery_inbox(
 event_id text primary key,provider_message_id text not null,event_type text not null check(event_type in ('email.delivered','email.bounced')),
 event_at timestamptz not null,applied boolean not null default false,received_at timestamptz not null default now()
);
alter table public.management_delivery_inbox enable row level security;
revoke all on public.management_delivery_inbox from public,anon,authenticated;
grant all on public.management_delivery_inbox to service_role;
create index management_delivery_inbox_pending on public.management_delivery_inbox(provider_message_id,event_at) where not applied;
create or replace function public.apply_management_delivery_events(p_provider_id text) returns void language plpgsql security invoker set search_path='' as $$
declare dispatch public.management_dispatches%rowtype;item public.management_delivery_inbox%rowtype;
begin
 select * into dispatch from public.management_dispatches where provider_message_id=p_provider_id and status='Sent' for update;
 if not found then return;end if;
 for item in select * from public.management_delivery_inbox where provider_message_id=p_provider_id and not applied order by event_at,event_id for update loop
  insert into public.management_dispatch_events(dispatch_key,block_id,at,event,detail,provider_event_id) values(dispatch.idempotency_key,dispatch.block_id,item.event_at,item.event_type,jsonb_build_object('providerId',p_provider_id),item.event_id) on conflict(provider_event_id) do nothing;
  if dispatch.delivery_status='Provider accepted' then
   update public.management_dispatches set delivery_status=case when item.event_type='email.delivered' then 'Delivered' else 'Bounced' end,delivered_at=case when item.event_type='email.delivered' then item.event_at else null end where idempotency_key=dispatch.idempotency_key;
   dispatch.delivery_status:=case when item.event_type='email.delivered' then 'Delivered' else 'Bounced' end;
  end if;
  update public.management_delivery_inbox set applied=true where event_id=item.event_id;
 end loop;
end $$;
create or replace function public.record_management_delivery_event(p_event_id text,p_provider_id text,p_event text,p_at timestamptz) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if nullif(btrim(p_event_id),'') is null or nullif(btrim(p_provider_id),'') is null or p_event not in ('email.delivered','email.bounced') or p_at is null then raise exception 'Invalid delivery event';end if;
 insert into public.management_delivery_inbox(event_id,provider_message_id,event_type,event_at) values(p_event_id,p_provider_id,p_event,p_at) on conflict(event_id) do nothing;
 if not found then return false;end if;
 perform public.apply_management_delivery_events(p_provider_id);return true;
end $$;
revoke all on function public.apply_management_delivery_events(text) from public,anon,authenticated;
grant execute on function public.apply_management_delivery_events(text) to service_role;
-- Source corrections cannot race an already claimed submission. Once a provider
-- outcome is known (or explicitly uncertain), corrections can be reviewed normally.
create or replace function public.guard_inflight_management_source() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.management_dispatches d where d.block_id=old.block_id and d.status='Sending' and ((old.area='financials' and d.envelope #>> '{sourceEvidence,financialRevision}'=old.revision::text) or (old.area='debtors' and d.envelope #>> '{sourceEvidence,reminderRevision}'=old.revision::text) or (old.area='leaseholders' and (d.envelope #>> '{sourceEvidence,contactRevision}'=old.revision::text or d.envelope #>> '{sourceEvidence,consultationRevision}'=old.revision::text)))) then raise exception 'A delivery using this revision is in progress. Review its outcome before changing the source.' using errcode='40001';end if;return new;
end $$;
revoke all on function public.guard_inflight_management_source() from public,anon,authenticated;
create trigger guard_inflight_management_source before update on public.management_review_state for each row execute function public.guard_inflight_management_source();
create view public.management_dispatch_summary with (security_invoker=true) as
 select block_id,unit_id,max(sent_at) filter(where kind='Demand' and status='Sent') as last_demand_sent
 from public.management_dispatches where unit_id is not null group by block_id,unit_id;
revoke all on public.management_dispatch_summary from public,anon;
grant select on public.management_dispatch_summary to authenticated,service_role;
