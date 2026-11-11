-- LOCAL REVIEW ONLY. Apply after management_dispatch.sql; does not enable either delivery flag.
-- Bulk claims have a two-minute lease. Mutations expire abandoned claims to Uncertain,
-- never retry them, then block only the affected unit (or building-wide source) while active.
alter table public.management_dispatches drop constraint management_dispatches_kind_check;
alter table public.management_dispatches add constraint management_dispatches_kind_check check(kind in ('Demand','Credit note','First reminder','Final reminder','Section20','Overdue account reminder','Friendly balance notice'));
create unique index bulk_reminder_one_account_day on public.management_dispatches(block_id,unit_id,recipient,(envelope #>> '{sourceEvidence,bulkReminder,asOf}')) where kind in ('Overdue account reminder','Friendly balance notice') and status in ('Pending','Sending','Sent','Uncertain');
create table public.bulk_reminder_revisions(block_id bigint primary key references public.blocks(id) on delete cascade,revision bigint not null default 0 check(revision>=0));
insert into public.bulk_reminder_revisions(block_id) select id from public.blocks;
alter table public.bulk_reminder_revisions enable row level security;
revoke all on public.bulk_reminder_revisions from public,anon,authenticated;
grant select,insert,update,delete on public.bulk_reminder_revisions to service_role;

create function public.lock_bulk_reminder_block(p_block bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare v bigint;
begin
 select revision into v from public.bulk_reminder_revisions where block_id=p_block for update;
 if not found then raise exception 'Bulk reminder building revision is unavailable';end if;return v;
end $$;
create function public.expire_bulk_reminder_claims(p_block bigint,p_now timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare r public.management_dispatches%rowtype;n integer:=0;
begin
 for r in update public.management_dispatches set status='Uncertain',error_message='Bulk reminder lease expired; reconcile provider acceptance before any retry' where block_id=p_block and kind in ('Overdue account reminder','Friendly balance notice') and status='Sending' and claimed_at<=p_now-interval '2 minutes' returning * loop
  insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(r.idempotency_key,r.block_id,'Uncertain',jsonb_build_object('reason',r.error_message));
  n:=n+1;
 end loop;
 return n;
end $$;
create function public.guard_bulk_reminder_mutation() returns trigger language plpgsql security definer set search_path='' as $$
declare blocks bigint[];b bigint;
begin
 if tg_table_name='management_review_state' then
  if coalesce(new.area,old.area)<>'leaseholders' then return coalesce(new,old);end if;
 end if;
 if tg_table_name='blocks' and tg_op='INSERT' then insert into public.bulk_reminder_revisions(block_id) values(new.id);return new;end if;
 if tg_table_name='blocks' then blocks:=array[old.id];
 else blocks:=case when tg_op='INSERT' then array[new.block_id] when tg_op='DELETE' then array[old.block_id] else array[old.block_id,new.block_id] end;end if;
 -- Match queue/snapshot/claim order: building revision first, then dispatch rows.
 for b in select distinct value from unnest(blocks) value where value is not null order by value loop
  perform public.lock_bulk_reminder_block(b);
  perform public.expire_bulk_reminder_claims(b,clock_timestamp());
  if tg_table_name='service_charge_entries' then
   if exists(select 1 from public.management_dispatches d where d.block_id=b and d.kind in ('Overdue account reminder','Friendly balance notice') and d.status='Sending' and d.unit_id in (case when tg_op<>'INSERT' then old.unit_id end,case when tg_op<>'DELETE' then new.unit_id end)) then raise exception 'A bulk reminder for this unit is being submitted. Retry the payment after its outcome is recorded (maximum two-minute claim lease).' using errcode='40001';end if;
  elsif tg_table_name='units' then
   if exists(select 1 from public.management_dispatches d where d.block_id=b and d.kind in ('Overdue account reminder','Friendly balance notice') and d.status='Sending' and d.unit_id in (case when tg_op<>'INSERT' then old.id end,case when tg_op<>'DELETE' then new.id end)) then raise exception 'A bulk reminder for this unit is being submitted. Retry after its outcome is recorded.' using errcode='40001';end if;
  else
   if exists(select 1 from public.management_dispatches d where d.block_id=b and d.kind in ('Overdue account reminder','Friendly balance notice') and d.status='Sending') then raise exception 'A bulk reminder is being submitted using this building/contact source. Retry after its outcome is recorded (maximum two-minute claim lease).' using errcode='40001';end if;
  end if;
  update public.bulk_reminder_revisions set revision=revision+1 where block_id=b;
 end loop;
 return coalesce(new,old);
end $$;
create trigger a_bulk_reminder_ledger_guard before insert or update or delete on public.service_charge_entries for each row execute function public.guard_bulk_reminder_mutation();
create trigger a_bulk_reminder_unit_guard before insert or update or delete on public.units for each row execute function public.guard_bulk_reminder_mutation();
create trigger a_bulk_reminder_contact_guard before insert or update or delete on public.management_review_state for each row execute function public.guard_bulk_reminder_mutation();
create trigger a_bulk_reminder_building_guard before update or delete on public.blocks for each row execute function public.guard_bulk_reminder_mutation();
create trigger a_bulk_reminder_building_added after insert on public.blocks for each row execute function public.guard_bulk_reminder_mutation();

create function public.read_bulk_reminder_snapshot(p_block_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare rev bigint;v_block jsonb;v_units jsonb;v_entries jsonb;v_protected jsonb;v_state jsonb;v_contact_rev bigint;v_today date:=(clock_timestamp() at time zone 'Europe/London')::date;
begin
 if current_setting('role',true)<>'service_role' and not exists(select 1 from public.portal_members m join public.blocks b on b.id=p_block_id where m.email=lower(auth.jwt()->>'email') and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))) then raise exception 'Manager building access required' using errcode='42501';end if;
 rev:=public.lock_bulk_reminder_block(p_block_id);
 if (select count(*) from public.units where block_id=p_block_id)>100000 or (select count(*) from public.service_charge_entries where block_id=p_block_id and entry_date<=v_today)>100000 then raise exception 'Complete snapshot exceeds 100,000-row limit';end if;
 select jsonb_build_object('id',id,'name',name,'address',address) into v_block from public.blocks where id=p_block_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'blockId',block_id,'unitNumber',unit_number,'paymentReference',payment_reference) order by id),'[]') into v_units from public.units where block_id=p_block_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'block_id',block_id,'unit_id',unit_id,'entry_type',entry_type,'description',description,'amount_pence',amount_pence,'entry_date',entry_date,'due_date',due_date,'reference',reference) order by id),'[]') into v_entries from public.service_charge_entries where block_id=p_block_id and entry_date<=v_today;
 select state,revision into v_state,v_contact_rev from public.management_review_state where block_id=p_block_id and area='leaseholders';
 -- Address-level protection permits a fresh reviewed replacement for an unsent joint
 -- recipient without including another recipient whose submission is already protected.
 select coalesce(jsonb_agg(jsonb_build_object('unitId',unit_id,'recipient',recipient,'status',status,'idempotencyKey',idempotency_key) order by unit_id,recipient,idempotency_key),'[]') into v_protected from public.management_dispatches where block_id=p_block_id and kind in ('Overdue account reminder','Friendly balance notice') and status in ('Pending','Sending','Sent','Uncertain') and envelope #>> '{sourceEvidence,bulkReminder,asOf}'=v_today::text;
 return jsonb_build_object('block',v_block,'units',v_units,'entries',v_entries,'protectedRecipients',v_protected,'contactState',coalesce(v_state,'{"contacts":[],"consultations":[]}'::jsonb),'contactRevision',coalesce(v_contact_rev,0),'ledgerRevision',rev::text,'asOf',v_today,'generatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- The same allocation basis as chargeSummary: oldest due/entry date then ID, using posted credits/payments.
create function public.bulk_reminder_account_eligible(p_block bigint,p_unit bigint,p_kind text,p_as_of date) returns boolean language sql stable security definer set search_path='' as $$
 with entries as (select * from public.service_charge_entries where block_id=p_block and unit_id=p_unit and entry_date<=p_as_of),settled as(select coalesce(sum(amount_pence),0) amount from entries where entry_type in ('Payment','Credit')),charges as(select amount_pence,due_date,coalesce(sum(amount_pence) over(order by coalesce(due_date,entry_date),id rows between unbounded preceding and 1 preceding),0) previous from entries where entry_type='Charge')
 select exists(select 1 from public.units where id=p_unit and block_id=p_block) and (select coalesce(sum(case when entry_type='Charge' then amount_pence else -amount_pence end),0)>0 from entries) and (p_kind='Friendly balance notice' or (p_kind='Overdue account reminder' and (select coalesce(sum(greatest(0,c.amount_pence-greatest(0,s.amount-c.previous))),0)>0 from charges c cross join settled s where c.due_date<p_as_of)))
$$;
-- Stored PDFs are immutable approved bytes. The application creates and renders the
-- unit-specific document; SQL checks representation, exact byte digest and scope again
-- at queue, claim and final submission authorization. It does not regenerate documents.
create function public.bulk_reminder_statement_valid(p_row public.management_dispatches) returns boolean language plpgsql immutable security definer set search_path='' as $$
declare attachment jsonb;evidence jsonb;pdf bytea;content text;
begin
 if jsonb_typeof(p_row.envelope->'attachments') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_row.envelope->'attachments')<>1 then return false;end if;
 attachment:=p_row.envelope->'attachments'->0;evidence:=p_row.envelope #> '{sourceEvidence,bulkReminder,statement}';
 if jsonb_typeof(attachment) is distinct from 'object' or jsonb_typeof(evidence) is distinct from 'object' then return false;end if;
 if attachment->>'mediaType' is distinct from 'application/pdf' or attachment->>'encoding' is distinct from 'base64' or coalesce(attachment->>'fileName','')!~'^[A-Za-z0-9][A-Za-z0-9._ -]{0,240}\.pdf$' then return false;end if;
 content:=attachment->>'content';
 if content is null or length(content) not between 8 and 3000000 or content!~'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then return false;end if;
 pdf:=pg_catalog.decode(content,'base64');
 if substring(pdf from 1 for 5)<>pg_catalog.decode('255044462d','hex') then return false;end if;
 return coalesce(evidence->>'blockId'=p_row.block_id::text and evidence->>'unitId'=p_row.unit_id::text and evidence->>'asOf'=p_row.envelope #>> '{sourceEvidence,bulkReminder,asOf}' and evidence->>'sha256'=pg_catalog.encode(pg_catalog.sha256(pdf),'hex'),false);
exception when others then return false;
end $$;
create function public.bulk_reminder_row_current(p_row public.management_dispatches,p_revision bigint,p_today date) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.bulk_reminder_statement_valid(p_row) and p_row.envelope #>> '{sourceEvidence,bulkReminder,ledgerRevision}'=p_revision::text and p_row.envelope #>> '{sourceEvidence,bulkReminder,asOf}'=p_today::text and ((p_row.kind='Overdue account reminder' and p_row.envelope #>> '{sourceEvidence,bulkReminder,mode}'='overdue') or (p_row.kind='Friendly balance notice' and p_row.envelope #>> '{sourceEvidence,bulkReminder,mode}'='outstanding')) and exists(select 1 from public.management_review_state s where s.block_id=p_row.block_id and s.area='leaseholders' and s.revision::text=p_row.envelope #>> '{sourceEvidence,contactRevision}') and public.management_dispatch_recipient_allowed(p_row.block_id,p_row.unit_id,p_row.kind,p_row.recipient) and public.bulk_reminder_account_eligible(p_row.block_id,p_row.unit_id,p_row.kind,p_today) and exists(select 1 from public.portal_members m join public.blocks b on b.id=p_row.block_id where m.email=p_row.approved_by and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))),false)
$$;
create function public.queue_bulk_reminder_dispatches(p_rows jsonb,p_actor text,p_revision text,p_as_of date) returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb;r public.management_dispatches%rowtype;b bigint;rev bigint;today date:=(clock_timestamp() at time zone 'Europe/London')::date;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Provide 1–1,000 exact individual messages';end if;
 b:=(p_rows->0->>'block_id')::bigint;rev:=public.lock_bulk_reminder_block(b);
 if p_revision is distinct from rev::text or p_as_of is distinct from today then raise exception 'Ledger or statement day changed. Preview again.' using errcode='40001';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  r:=jsonb_populate_record(null::public.management_dispatches,item);r.approved_by:=p_actor;
  if r.block_id is distinct from b or r.kind not in ('Overdue account reminder','Friendly balance notice') or not public.bulk_reminder_row_current(r,rev,today) or coalesce(r.envelope #>> '{sourceEvidence,bulkReminder,previewToken}','')!~'^[a-f0-9]{64}$' or coalesce(r.envelope #>> '{sourceEvidence,bulkReminder,fingerprint}','')!~'^[a-f0-9]{64}$' or (r.scheduled_at at time zone 'Europe/London')::date is distinct from today then raise exception 'Bulk snapshot, recipient or account changed. Preview again.' using errcode='40001';end if;
 end loop;
 return public.queue_management_dispatches(p_rows,p_actor);
end $$;

-- Separate opt-in RPC: legacy worker cannot claim generic bulk reminders accidentally.
create function public.claim_bulk_reminder_dispatches(p_at timestamptz,p_block_id bigint default null) returns setof public.management_dispatches language plpgsql security invoker set search_path='' as $$
declare candidate record;r public.management_dispatches%rowtype;rev bigint;today date:=(clock_timestamp() at time zone 'Europe/London')::date;
begin
 -- Read candidate IDs without a row lock, then serialize building before dispatch.
 for candidate in select idempotency_key,block_id from public.management_dispatches where kind in ('Overdue account reminder','Friendly balance notice') and ((status='Pending' and scheduled_at<=p_at) or (status='Sending' and claimed_at<=clock_timestamp()-interval '2 minutes')) and (p_block_id is null or block_id=p_block_id) order by scheduled_at,idempotency_key limit 100 loop
  rev:=public.lock_bulk_reminder_block(candidate.block_id);
  perform public.expire_bulk_reminder_claims(candidate.block_id,clock_timestamp());
  select * into r from public.management_dispatches where idempotency_key=candidate.idempotency_key and status='Pending' for update skip locked;
  if not found then continue;end if;
  if not public.bulk_reminder_row_current(r,rev,today) then
   update public.management_dispatches set status='Failed',error_message='Ledger, statement day, recipient or manager scope changed; new preview required' where idempotency_key=r.idempotency_key;
   insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(r.idempotency_key,r.block_id,'Approval invalidated','{}');continue;
  end if;
  update public.management_dispatches set status='Sending',claim_token=gen_random_uuid(),claimed_at=clock_timestamp(),attempt_count=attempt_count+1 where idempotency_key=r.idempotency_key returning * into r;
  insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(r.idempotency_key,r.block_id,'Sending',jsonb_build_object('attempt',r.attempt_count,'leaseSeconds',120));
  return next r;return;
 end loop;
end $$;
create function public.verify_bulk_reminder_submission(p_key text,p_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare b bigint;rev bigint;r public.management_dispatches%rowtype;today date:=(clock_timestamp() at time zone 'Europe/London')::date;
begin
 select block_id into b from public.management_dispatches where idempotency_key=p_key and kind in ('Overdue account reminder','Friendly balance notice');if not found then return false;end if;
 rev:=public.lock_bulk_reminder_block(b);perform public.expire_bulk_reminder_claims(b,clock_timestamp());
 select * into r from public.management_dispatches where idempotency_key=p_key for update;
 return coalesce(r.status='Sending' and r.claim_token=p_token and r.claimed_at>clock_timestamp()-interval '75 seconds' and public.bulk_reminder_row_current(r,rev,today),false);
end $$;

revoke all on function public.lock_bulk_reminder_block(bigint),public.expire_bulk_reminder_claims(bigint,timestamptz),public.guard_bulk_reminder_mutation(),public.bulk_reminder_account_eligible(bigint,bigint,text,date),public.bulk_reminder_statement_valid(public.management_dispatches),public.bulk_reminder_row_current(public.management_dispatches,bigint,date),public.read_bulk_reminder_snapshot(bigint),public.queue_bulk_reminder_dispatches(jsonb,text,text,date),public.claim_bulk_reminder_dispatches(timestamptz,bigint),public.verify_bulk_reminder_submission(text,uuid) from public,anon,authenticated;
grant execute on function public.read_bulk_reminder_snapshot(bigint) to authenticated,service_role;
grant execute on function public.lock_bulk_reminder_block(bigint),public.expire_bulk_reminder_claims(bigint,timestamptz),public.bulk_reminder_account_eligible(bigint,bigint,text,date),public.bulk_reminder_statement_valid(public.management_dispatches),public.bulk_reminder_row_current(public.management_dispatches,bigint,date),public.queue_bulk_reminder_dispatches(jsonb,text,text,date),public.claim_bulk_reminder_dispatches(timestamptz,bigint),public.verify_bulk_reminder_submission(text,uuid) to service_role;

-- Preserve legacy claim behavior but exclude separately gated bulk messages.
create or replace function public.claim_management_dispatches(p_at timestamptz,p_block_id bigint default null)
 returns setof public.management_dispatches language plpgsql security invoker set search_path='' as $$
declare row public.management_dispatches%rowtype;
begin
 -- A crashed submission is uncertain, never automatically retried.
 for row in update public.management_dispatches set status='Uncertain',error_message='Worker lease expired; reconcile provider acceptance before retrying' where kind not in ('Overdue account reminder','Friendly balance notice') and status='Sending' and claimed_at<p_at-interval '15 minutes' and (p_block_id is null or block_id=p_block_id) returning * loop
  insert into public.management_dispatch_events(dispatch_key,block_id,event,detail) values(row.idempotency_key,row.block_id,'Uncertain',jsonb_build_object('reason',row.error_message));
 end loop;
 for row in select d.* from public.management_dispatches d where d.kind not in ('Overdue account reminder','Friendly balance notice') and d.status='Pending' and d.scheduled_at<=p_at and (p_block_id is null or d.block_id=p_block_id) order by d.scheduled_at,d.idempotency_key for update skip locked limit 1 loop
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

-- Recovery is independent of delivery activation. Server-side manager authorization must
-- precede this service-role-only RPC; it never claims or submits a message.
create function public.recover_bulk_reminder_claims(p_block_id bigint) returns integer language plpgsql security invoker set search_path='' as $$
begin
 perform public.lock_bulk_reminder_block(p_block_id);
 return public.expire_bulk_reminder_claims(p_block_id,clock_timestamp());
end $$;
revoke all on function public.recover_bulk_reminder_claims(bigint) from public,anon,authenticated;
grant execute on function public.recover_bulk_reminder_claims(bigint) to service_role;
