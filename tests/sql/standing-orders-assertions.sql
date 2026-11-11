-- Apply service_charges, automatic_invoice_numbers, bank_reconciliation and standing_orders first.
update public.units set payment_reference=case id when 10 then 'LON10' when 11 then 'LON11' else 'OTHER20' end;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid","role":"authenticated"}',false);
select public.save_standing_order(1,'{"unitId":10,"amountPence":12500,"startDate":"2026-01-31","cadence":"quarterly","dueOffsetDays":30,"invoiceMode":"auto_invoice","allocationMode":"auto_exact_match","enabled":true,"leaseConfirmed":true,"leaseReference":"Synthetic lease clause 4"}',0);
select public.save_standing_order(1,'{"unitId":11,"amountPence":5000,"startDate":"2026-09-29","cadence":"english_quarterly","dueOffsetDays":0,"invoiceMode":"invoice_review","allocationMode":"allocation_review","enabled":true,"leaseConfirmed":true,"leaseReference":"Synthetic lease clause 5"}',0);
select public.stage_bank_statement(1,'[{"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","transaction_date":"2026-10-01","amount_pence":12500,"bank_reference":" lon 10 ","description":"Actual receipt one","transaction_id":"TEST1","source_file":"synthetic.csv"},{"fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","transaction_date":"2026-10-01","amount_pence":12500,"bank_reference":"LON10","description":"Actual receipt two same day","transaction_id":"TEST2","source_file":"synthetic.csv"},{"fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","transaction_date":"2026-10-01","amount_pence":12000,"bank_reference":"LON10","description":"Wrong amount","transaction_id":"TEST3","source_file":"synthetic.csv"},{"fingerprint":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","transaction_date":"2026-10-01","amount_pence":12500,"bank_reference":"Payment LON10","description":"Substring only","transaction_id":"TEST4","source_file":"synthetic.csv"}]');
select public.process_standing_orders(1,'2026-11-02');
select public.process_standing_orders(1,'2026-11-02');
do $$begin
 if (select count(*) from public.service_charge_entries where entry_type='Charge')<>4 then raise exception 'Quarterly replay invoice count wrong';end if;
 if (select count(*) from public.service_charge_entries where entry_type='Payment')<>2 then raise exception 'Actual bank receipt count wrong';end if;
 if (select count(*) from public.bank_statement_rows where status='Pending')<>2 then raise exception 'Inexact bank receipts were allocated';end if;
 if (select count(*) from public.standing_order_runs where action='Invoice prepared')<>1 then raise exception 'English quarter preparation missing';end if;
 if (select count(*) from public.standing_order_runs where action='Payment allocated')<>2 then raise exception 'Same-day actual receipts collapsed';end if;
 if not exists(select 1 from public.service_charge_entries where entry_date='2026-10-31' and due_date='2026-11-30') then raise exception 'Separate due date lost';end if;
 if public.post_bank_payments(1,jsonb_build_array(jsonb_build_object('id',(select id from public.bank_statement_rows where transaction_id='TEST1'),'unit_id',10)))<>0 then raise exception 'Manual bank posting duplicated auto-matched receipt';end if;
 begin perform public.save_standing_order(1,'{"unitId":10,"amountPence":12500,"startDate":"2026-01-31","cadence":"quarterly","dueOffsetDays":30,"invoiceMode":"auto_invoice","allocationMode":"auto_exact_match","enabled":true,"leaseConfirmed":true,"leaseReference":"Synthetic lease"}',0);raise exception 'Stale settings accepted';exception when serialization_failure then null;end;
 begin perform public.process_standing_orders(1,(now() at time zone 'Europe/London')::date+1);raise exception 'Future processor accepted';exception when others then if sqlerrm='Future processor accepted' then raise;end if;end;
end$$;
reset role;
-- Composite foreign keys must reject a scoped audit row pointing to another block.
insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by) values(2,20,'Charge','Other block',100,'2026-01-01','2026-01-01','OTHER','other@example.invalid');
do $$declare v_order bigint;v_entry bigint;v_bank bigint;begin
 select id into v_order from public.standing_orders where unit_id=10;
 select id into v_entry from public.service_charge_entries where reference='OTHER';
 begin insert into public.standing_order_runs(order_id,block_id,occurrence_date,action,ledger_entry_id,snapshot,created_by) values(v_order,1,'2020-01-01','Invoice posted',v_entry,'{}','manager@example.invalid');raise exception 'Cross-block ledger audit accepted';exception when foreign_key_violation then null;end;
 insert into public.bank_statement_rows(block_id,fingerprint,transaction_date,amount_pence,bank_reference,source_file,imported_by) values(2,repeat('f',64),'2026-10-01',12500,'OTHER20','synthetic.csv','other@example.invalid') returning id into v_bank;
 select id into v_entry from public.service_charge_entries where block_id=1 and entry_type='Payment' order by id limit 1;
 begin insert into public.standing_order_runs(order_id,block_id,occurrence_date,action,ledger_entry_id,bank_row_id,snapshot,created_by) values(v_order,1,'2020-01-02','Payment allocated',v_entry,v_bank,'{}','manager@example.invalid');raise exception 'Cross-block bank audit accepted';exception when foreign_key_violation then null;end;
end$$;
-- A separate genuine receipt and newly enabled period test service INSERT/UPDATE/sequence grants.
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid","role":"authenticated"}',false);
select public.save_standing_order(1,'{"unitId":12,"amountPence":3000,"startDate":"2026-11-01","cadence":"annual","dueOffsetDays":30,"invoiceMode":"auto_invoice","allocationMode":"allocation_review","enabled":true,"leaseConfirmed":true,"leaseReference":"Synthetic lease clause 6"}',0);
select public.stage_bank_statement(1,'[{"fingerprint":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","transaction_date":"2026-11-01","amount_pence":12500,"bank_reference":"LON10","description":"Actual service-job receipt","transaction_id":"TEST5","source_file":"synthetic.csv"}]');
reset role;
-- Service-role path exercises explicit grants, deterministic retry and actual receipts.
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.process_standing_orders(1,'2026-11-02');
do $$begin
 if (select count(*) from public.service_charge_entries where block_id=1)<>8 then raise exception 'Service job did not post one new invoice and actual receipt';end if;
end$$;
select public.process_standing_orders(1,'2026-11-02');
do $$begin
 if (select count(*) from public.service_charge_entries where block_id=1)<>8 then raise exception 'Service replay duplicated entries';end if;
end$$;
reset role;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","email":"other@example.invalid","role":"authenticated"}',false);
do $$begin
 if (select count(*) from public.standing_orders where block_id=1)<>0 then raise exception 'Cross-block standing orders exposed';end if;
 begin perform public.process_standing_orders(1,'2026-11-02');raise exception 'Cross-block processor accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'PASS standing orders: manager/service replay, exact real receipts, same-day receipts, lease cadence, due dates, revisions and cross-block scope' as result;
