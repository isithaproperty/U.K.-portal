set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid"}',false);
select * from public.save_management_review(1,'financials','{"prepared":{"input":{"batchId":"local-db-1"}}}',0);
select public.post_saved_management_batch(1,'local-db-1',1,'[{"unit_number":"Flat 1","entry_type":"Charge","description":"Lease budget","amount_pence":10000,"entry_date":"2026-11-02","due_date":"2026-12-25","reference":"","request_id":"00000000-0000-8000-8000-000000000001"}]');
select public.post_saved_management_batch(1,'local-db-1',1,'[{"unit_number":"Flat 1","entry_type":"Charge","description":"Lease budget","amount_pence":10000,"entry_date":"2026-11-02","due_date":"2026-12-25","reference":"","request_id":"00000000-0000-8000-8000-000000000001"}]');
do $$begin
 if (select count(*) from public.service_charge_entries)<>1 then raise exception 'Ledger replay duplicated charge';end if;
 if (select due_date from public.service_charge_entries limit 1)<>'2026-12-25'::date then raise exception 'Future due date lost';end if;
 begin perform public.post_saved_management_batch(1,'local-db-1',0,'[]');raise exception 'Stale batch posted';exception when serialization_failure then null;end;
 begin perform public.post_saved_management_batch(1,'changed-batch',1,'[]');raise exception 'Wrong batch posted';exception when serialization_failure then null;end;
 begin perform public.post_saved_management_batch(1,'local-db-1',1,'[{"entry_type":"Payment","request_id":"00000000-0000-8000-8000-000000000002"}]');raise exception 'Payment accepted';exception when others then if sqlerrm='Payment accepted' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","email":"other@example.invalid"}',false);
do $$begin begin perform public.post_saved_management_batch(1,'local-db-1',1,'[]');raise exception 'Cross block posted';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS: existing ledger RPC + locked saved batch, idempotent retry, future due date and manager scope' as result;
