set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid"}',false);
select * from public.save_management_review(1,'leaseholders','{"contacts":[{"id":"owner","blockId":1,"unitId":10,"role":"Leaseholder","emails":["owner@example.invalid"],"demands":true},{"id":"tenant","blockId":1,"unitId":10,"role":"Tenant","emails":["tenant@example.invalid"],"demands":false}],"consultations":[{"id":"notice-review","title":"Example works","confirmed":true,"basisDate":"2026-09-01"}]}',0);
do $$begin
 begin perform public.queue_management_dispatches('[]','manager@example.invalid');raise exception 'Manager bypassed source checks';exception when insufficient_privilege then null;end;
 begin insert into public.management_dispatches(idempotency_key) values('direct-insert-bypass');raise exception 'Direct queue bypass allowed';exception when insufficient_privilege then null;end;
 if public.management_dispatch_recipient_allowed(1,10,'Demand','tenant@example.invalid') then raise exception 'Tenant demand recipient allowed';end if;
end $$;
reset role;set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.queue_management_dispatches(jsonb_build_array(jsonb_build_object('idempotency_key','mgmt-v1-'||repeat('a',64),'block_id',1,'unit_id',10,'operation_id','financial:one','kind','Demand','recipient','owner@example.invalid','scheduled_at','2026-11-02T10:00:00Z','envelope',jsonb_build_object('idempotencyKey','mgmt-v1-'||repeat('a',64),'blockId',1,'unitId',10,'operationId','financial:one','kind','Demand','to','owner@example.invalid','subject','Exact subject','body','Exact body','attachments',jsonb_build_array(jsonb_build_object('fileName','demand.txt','mediaType','text/plain','encoding','utf8','content','Exact attachment')),'sourceEvidence',jsonb_build_object('contactRevision',1,'financialRevision',1)))),'manager@example.invalid');
-- Repeat queue is durable even outside provider idempotency window.
select public.queue_management_dispatches(jsonb_build_array(jsonb_build_object('idempotency_key','mgmt-v1-'||repeat('a',64),'block_id',1,'unit_id',10,'operation_id','financial:one','kind','Demand','recipient','owner@example.invalid','scheduled_at','2026-11-02T10:00:00Z','envelope',(select envelope from public.management_dispatches limit 1))),'manager@example.invalid');
do $$begin if (select count(*) from public.management_dispatches)<>1 then raise exception 'Queue replay duplicated';end if;end $$;
-- Provider webhook arrives before submission persistence: it must be retained.
select public.record_management_delivery_event('webhook-early','provider-one','email.delivered','2026-11-02T10:01:00Z');
select idempotency_key,status from public.claim_management_dispatches('2026-11-02T10:00:01Z',1);
reset role;set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid"}',false);
do $$begin begin perform * from public.save_management_review(1,'financials',(select state from public.management_review_state where block_id=1 and area='financials'),1);raise exception 'In-flight source correction raced send';exception when serialization_failure then null;end;end $$;
reset role;set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);

do $$begin
 if (select count(*) from public.claim_management_dispatches('2026-11-02T10:00:02Z',1))<>0 then raise exception 'Concurrent worker claimed same item';end if;
 perform public.finish_management_dispatch('mgmt-v1-'||repeat('a',64),(select claim_token from public.management_dispatches limit 1),'Sent','provider-one','Provider accepted exact message');
 if (select delivery_status from public.management_dispatches limit 1)<>'Delivered' then raise exception 'Early webhook was lost';end if;
 if not exists(select 1 from public.management_dispatches where sent_at is not null and status='Sent') then raise exception 'Sent history missing';end if;
 if public.record_management_delivery_event('webhook-early','provider-one','email.delivered','2026-11-02T10:01:00Z') then raise exception 'Webhook replay not suppressed';end if;
 begin update public.management_dispatches set envelope='{}';raise exception 'Approved snapshot editable';exception when others then if sqlerrm='Approved snapshot editable' then raise;end if;end;
end $$;
select public.create_management_review_alerts('2026-11-02');
select public.create_management_review_alerts('2026-11-02');
do $$begin if (select count(*) from public.management_manager_alerts)<>1 then raise exception 'Internal review alert missing or duplicated';end if;end $$;
-- A queued source that changed requires new approval, never silent use of superseded text.
insert into public.management_dispatches(idempotency_key,block_id,unit_id,operation_id,kind,recipient,envelope,scheduled_at,approved_by) select 'mgmt-v1-'||repeat('b',64),block_id,unit_id,'financial:changed',kind,recipient,jsonb_set(jsonb_set(envelope,'{idempotencyKey}',to_jsonb('mgmt-v1-'||repeat('b',64))),'{operationId}','"financial:changed"'),'2026-11-02T10:00:00Z',approved_by from public.management_dispatches limit 1;
reset role;set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid"}',false);
select * from public.save_management_review(1,'financials',(select state from public.management_review_state where block_id=1 and area='financials'),1);
reset role;set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$begin
 if (select count(*) from public.claim_management_dispatches('2026-11-02T10:00:02Z',1))<>0 then raise exception 'Superseded source sent';end if;
 if (select status from public.management_dispatches where operation_id='financial:changed')<>'Failed' then raise exception 'Superseded source was not invalidated';end if;
end $$;
insert into public.management_dispatches(idempotency_key,block_id,unit_id,operation_id,kind,recipient,envelope,scheduled_at,approved_by) select 'mgmt-v1-'||repeat('c',64),block_id,unit_id,'financial:third',kind,recipient,jsonb_set(jsonb_set(jsonb_set(envelope,'{idempotencyKey}',to_jsonb('mgmt-v1-'||repeat('c',64))),'{operationId}','"financial:third"'),'{sourceEvidence,financialRevision}','2'),'2026-11-02T10:00:00Z',approved_by from public.management_dispatches where status='Sent' limit 1;
select status from public.claim_management_dispatches('2026-11-02T10:01:00Z',1);
select status from public.claim_management_dispatches('2026-11-02T10:17:00Z',1);
do $$begin
 if (select status from public.management_dispatches where operation_id='financial:third')<>'Uncertain' then raise exception 'Expired claim blindly retried';end if;
 begin perform public.reconcile_management_dispatch('mgmt-v1-'||repeat('c',64),'Retry','manager@example.invalid','Blind retry without evidence');raise exception 'Uncertain retry allowed';exception when others then if sqlerrm='Uncertain retry allowed' then raise;end if;end;
 perform public.reconcile_management_dispatch('mgmt-v1-'||repeat('c',64),'Reconcile not accepted','manager@example.invalid','Provider support confirmed no acceptance');
 perform public.reconcile_management_dispatch('mgmt-v1-'||repeat('c',64),'Retry','manager@example.invalid','Definitive non-acceptance reviewed');
end $$;
reset role;set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","email":"tenant@example.invalid"}',false);
do $$begin
 if exists(select 1 from public.management_dispatches) or exists(select 1 from public.management_dispatch_events) or exists(select 1 from public.management_manager_alerts) then raise exception 'Tenant financial notification leak';end if;
 begin perform * from public.communication_delivery_requests;raise exception 'Tenant sees private send requests';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: durable queue, source invalidation, worker leases, early webhook/replay, exact snapshots, scoped history, internal alerts and source-check bypass prevention' as result;
