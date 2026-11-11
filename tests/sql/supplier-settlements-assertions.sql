-- Synthetic records only; after management_review.sql + supplier_settlements.sql.
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"manager@example.invalid"}',false);
select * from public.save_management_review(1,'creditors','{"invoices":[{"id":"invoice-1","workOrderId":101,"contractorId":9,"number":"SUP-1","amountPence":10000,"invoiceDate":"2026-01-01","dueDate":"2026-01-31"},{"id":"invoice-3","workOrderId":103,"contractorId":9,"number":"SUP-3","amountPence":10000,"invoiceDate":"2026-01-01","dueDate":"2026-01-31"}],"payments":[{"amountPence":999999999,"invoiceId":"invoice-1"}]}',0);
do $$begin
 begin update public.work_orders set payment_status='Paid',paid_at=now() where id=101;raise exception 'Manager direct paid toggle allowed';exception when insufficient_privilege then null;end;
 begin perform public.record_supplier_settlement(1,'{}');raise exception 'Manager settlement allowed';exception when insufficient_privilege then null;end;
 begin insert into public.supplier_settlements(id,block_id,bank_transaction_id,payment_date,amount_pence,evidence,request_snapshot,recorded_by) values('00000000-0000-0000-0000-000000000099',1,'forged',current_date,1,'forged evidence','{}','manager@example.invalid');raise exception 'REST settlement bypass allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","email":"owner@example.invalid"}',false);
do $$begin
 update public.work_orders set notes='Legacy normal edit',actual_cost=55 where id=104;
 if (select notes from public.work_orders where id=104)<>'Legacy normal edit' then raise exception 'Legacy paid metadata edits blocked';end if;
 begin update public.work_orders set payment_status='Paid' where id=101;raise exception 'Owner direct paid without allocation allowed';exception when others then if sqlerrm='Owner direct paid without allocation allowed' then raise;end if;end;
end $$;
select public.record_supplier_settlement(1,'{"requestId":"00000000-0000-0000-0000-000000000011","revision":1,"bankTransactionId":"bank-1","paymentDate":"2026-01-05","amountPence":4000,"evidence":"Owner checked bank statement transaction bank-1","confirmedActualPayment":true,"allocations":[{"invoiceId":"invoice-1","amountPence":4000}]}');
do $$begin
 if (select payment_status from public.work_orders where id=101)<>'Approved' then raise exception 'Partial settlement marked paid';end if;
 if (select count(*) from public.supplier_settlements)<>1 then raise exception 'Settlement missing';end if;
 begin perform public.record_supplier_settlement(1,'{"requestId":"00000000-0000-0000-0000-000000000012","revision":1,"bankTransactionId":"bank-1","paymentDate":"2026-01-05","amountPence":4000,"evidence":"Same actual transaction","confirmedActualPayment":true,"allocations":[{"invoiceId":"invoice-1","amountPence":4000}]}');raise exception 'Duplicate bank transaction allowed';exception when unique_violation then null;end;
 begin perform public.record_supplier_settlement(1,'{"requestId":"00000000-0000-0000-0000-000000000013","revision":1,"bankTransactionId":"bank-over","paymentDate":"2026-01-05","amountPence":7000,"evidence":"Excess allocation example","confirmedActualPayment":true,"allocations":[{"invoiceId":"invoice-1","amountPence":7000}]}');raise exception 'Over-allocation allowed';exception when others then if sqlerrm='Over-allocation allowed' then raise;end if;end;
 if (select count(*) from public.supplier_settlements)<>1 then raise exception 'Failed transaction did not rollback';end if;
 begin perform * from public.save_management_review(1,'creditors','{"invoices":[],"payments":[]}',1);raise exception 'Settled invoice removed';exception when others then if sqlerrm='Settled invoice removed' then raise;end if;end;
end $$;
-- Exact replay leaves a single immutable record.
select public.record_supplier_settlement(1,'{"requestId":"00000000-0000-0000-0000-000000000011","revision":1,"bankTransactionId":"bank-1","paymentDate":"2026-01-05","amountPence":4000,"evidence":"Owner checked bank statement transaction bank-1","confirmedActualPayment":true,"allocations":[{"invoiceId":"invoice-1","amountPence":4000}]}');
select public.record_supplier_settlement(1,'{"requestId":"00000000-0000-0000-0000-000000000014","revision":1,"bankTransactionId":"bank-2","paymentDate":"2026-01-06","amountPence":6000,"evidence":"Owner checked final bank settlement","confirmedActualPayment":true,"allocations":[{"invoiceId":"invoice-1","amountPence":6000}]}');
-- A fully settled invoice covering only half approved WO cost cannot mark WO paid.
select public.record_supplier_settlement(1,'{"requestId":"00000000-0000-0000-0000-000000000015","revision":1,"bankTransactionId":"bank-3","paymentDate":"2026-01-06","amountPence":10000,"evidence":"Owner checked bank statement bank-3","confirmedActualPayment":true,"allocations":[{"invoiceId":"invoice-3","amountPence":10000}]}');
do $$begin
 if (select payment_status from public.work_orders where id=101)<>'Paid' or (select paid_at from public.work_orders where id=101) is null then raise exception 'Full settlement did not synchronize WO';end if;
 if (select payment_status from public.work_orders where id=103)<>'Approved' then raise exception 'Missing invoice remainder incorrectly treated paid';end if;
 if (select count(*) from public.supplier_settlements)<>3 then raise exception 'Replay duplicated settlement';end if;
 update public.work_orders set notes='Unrelated edit allowed' where id=101;
 if (select notes from public.work_orders where id=101)<>'Unrelated edit allowed' then raise exception 'Ordinary canonical paid metadata edit blocked';end if;
 begin update public.work_orders set actual_cost=1 where id=101;raise exception 'Paid cost changed';exception when others then if sqlerrm='Paid cost changed' then raise;end if;end;
 begin update public.supplier_settlements set evidence='rewritten';raise exception 'Immutable evidence mutable';exception when insufficient_privilege then null;end;
 begin delete from public.supplier_settlement_allocations;raise exception 'Immutable allocations deleted';exception when insufficient_privilege then null;end;
 begin perform public.record_supplier_settlement(2,'{"requestId":"00000000-0000-0000-0000-000000000016","revision":1,"bankTransactionId":"wrong-block","paymentDate":"2026-01-06","amountPence":1,"evidence":"Cross block invalid","confirmedActualPayment":true,"allocations":[{"invoiceId":"invoice-1","amountPence":1}]}');raise exception 'Cross-block invoice accepted';exception when serialization_failure then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","email":"other@example.invalid"}',false);
do $$begin if exists(select 1 from public.supplier_settlements) or exists(select 1 from public.supplier_settlement_allocations) then raise exception 'Cross portfolio settlement leak';end if;end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","email":"tenant@example.invalid"}',false);
do $$begin
 if exists(select 1 from public.supplier_settlements) or exists(select 1 from public.supplier_settlement_allocations) then raise exception 'Tenant settlement leak';end if;
 begin perform public.record_supplier_settlement(1,'{}');raise exception 'Tenant settlement allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;set role anon;
do $$begin
 begin perform * from public.supplier_settlements;raise exception 'Anon settlement read';exception when insufficient_privilege then null;end;
 begin perform public.record_supplier_settlement(1,'{}');raise exception 'Anon settlement RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: owner-only actual settlements, immutable evidence, idempotence, partial/full WO paid sync and privacy' as result;
