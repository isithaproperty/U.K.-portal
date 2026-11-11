-- Apply after supplier_settlements.sql, before deploying the updated app.
-- Existing rows remain one-off. Mode is selected only when raising a work order.
begin;
alter table public.work_orders add column if not exists is_ongoing boolean not null default false;

-- Invoice-level settlements are authoritative for ongoing work. Payment never closes it.
create or replace function private.record_supplier_settlement(p_block_id bigint,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 saved public.management_review_state%rowtype;existing public.supplier_settlements%rowtype;
 item jsonb;invoice jsonb;other_invoice jsonb;wo public.work_orders%rowtype;
 request_id uuid;bank_id text;payment_day date;total bigint;allocated bigint;remaining bigint;
 invoice_id_value text;work_id bigint;affected bigint[]:='{}';all_settled boolean;last_paid timestamptz;
begin
 if auth.uid() is null or not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role='owner') then raise exception 'Owner access required' using errcode='42501';end if;
 if not exists(select 1 from public.blocks where id=p_block_id) then raise exception 'Unknown block';end if;
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>50000 or p_request->'confirmedActualPayment' is distinct from 'true'::jsonb then raise exception 'Explicit actual payment confirmation required';end if;
 request_id:=(p_request->>'requestId')::uuid;
 bank_id:=lower(btrim(p_request->>'bankTransactionId'));payment_day:=(p_request->>'paymentDate')::date;total:=(p_request->>'amountPence')::bigint;
 if request_id is null or bank_id is null or length(bank_id) not between 1 and 200 or bank_id~E'[\\r\\n]' or payment_day is null or payment_day>(now() at time zone 'Europe/London')::date or total is null or total not between 1 and 100000000 or length(btrim(coalesce(p_request->>'evidence',''))) not between 5 and 5000 then raise exception 'Invalid actual payment evidence';end if;
 -- Request replay is checked before revisions: a lost response remains retryable after a save.
 select * into existing from public.supplier_settlements where id=request_id;
 if found then
  if existing.block_id<>p_block_id or existing.request_snapshot<>p_request then raise exception 'Request identifier reused with changed evidence' using errcode='23505';end if;
  return jsonb_build_object('settlementId',existing.id,'replayed',true);
 end if;
 select * into saved from public.management_review_state where block_id=p_block_id and area='creditors' for update;
 if not found or saved.revision is distinct from (p_request->>'revision')::bigint then raise exception 'Creditor revision conflict' using errcode='40001';end if;
 if jsonb_typeof(saved.state->'invoices') is distinct from 'array' or jsonb_typeof(p_request->'allocations') is distinct from 'array' or jsonb_array_length(p_request->'allocations') not between 1 and 100 then raise exception 'Saved invoices and allocations required';end if;
 if (select count(*) from jsonb_array_elements(p_request->'allocations'))<>(select count(distinct x->>'invoiceId') from jsonb_array_elements(p_request->'allocations') x) then raise exception 'Duplicate invoice allocation';end if;
 select sum((x->>'amountPence')::bigint) into allocated from jsonb_array_elements(p_request->'allocations') x;
 if allocated is distinct from total then raise exception 'Transaction must be fully allocated';end if;
 insert into public.supplier_settlements(id,block_id,bank_transaction_id,payment_date,amount_pence,evidence,request_snapshot,recorded_by)
 values(request_id,p_block_id,bank_id,payment_day,total,btrim(p_request->>'evidence'),p_request,lower(auth.jwt()->>'email'));
 -- Acquire WO locks in a stable order, even for split transactions.
 for work_id in select distinct (inv->>'workOrderId')::bigint from jsonb_array_elements(saved.state->'invoices') inv join jsonb_array_elements(p_request->'allocations') a on a->>'invoiceId'=inv->>'id' order by 1 loop
  perform 1 from public.work_orders where id=work_id and block_id=p_block_id for update;
 end loop;
 for item in select * from jsonb_array_elements(p_request->'allocations') loop
  invoice_id_value:=item->>'invoiceId';allocated:=(item->>'amountPence')::bigint;
  if invoice_id_value is null or length(invoice_id_value) not between 1 and 200 or allocated is null or allocated<=0 then raise exception 'Invalid allocation';end if;
  if (select count(*) from jsonb_array_elements(saved.state->'invoices') inv where inv->>'id'=invoice_id_value)<>1 then raise exception 'Invoice must uniquely exist in saved block register';end if;
  select inv into invoice from jsonb_array_elements(saved.state->'invoices') inv where inv->>'id'=invoice_id_value;
  select * into wo from public.work_orders where id=(invoice->>'workOrderId')::bigint and block_id=p_block_id;
  if not found or wo.contractor_id is distinct from (invoice->>'contractorId')::bigint or (not wo.is_ongoing and wo.status<>'Complete') or (wo.is_ongoing and wo.status not in ('Open','In progress','On hold')) or wo.payment_status not in ('Approved','Paid') then raise exception 'Complete and approve the correct supplier work order before recording payment';end if;
  if wo.payment_status='Paid' and not exists(select 1 from public.supplier_settlement_allocations a where a.work_order_id=wo.id) then raise exception 'Legacy paid work orders require reviewed reconciliation before adding settlements';end if;
  if wo.actual_cost is null or wo.actual_cost<=0 or (invoice->>'amountPence')::bigint<=0 then raise exception 'Positive approved actual cost and invoice amount required';end if;
  if exists(select 1 from public.supplier_settlement_allocations a where a.block_id=p_block_id and a.invoice_id=invoice_id_value and a.invoice_snapshot<>invoice) then raise exception 'Settled invoice was modified';end if;
  select (invoice->>'amountPence')::bigint-coalesce(sum(a.amount_pence),0) into remaining from public.supplier_settlement_allocations a where a.block_id=p_block_id and a.invoice_id=invoice_id_value;
  if allocated>remaining then raise exception 'Allocation exceeds outstanding invoice amount';end if;
  insert into public.supplier_settlement_allocations(settlement_id,block_id,invoice_id,work_order_id,amount_pence,invoice_snapshot) values(request_id,p_block_id,invoice_id_value,wo.id,allocated,invoice);
  affected:=array_append(affected,wo.id);
 end loop;
 for work_id in select distinct unnest(affected) loop
  all_settled:=true;
  for other_invoice in select inv from jsonb_array_elements(saved.state->'invoices') inv where (inv->>'workOrderId')::bigint=work_id loop
   if (other_invoice->>'amountPence')::bigint<=0 or (select coalesce(sum(a.amount_pence),0) from public.supplier_settlement_allocations a where a.block_id=p_block_id and a.invoice_id=other_invoice->>'id')<(other_invoice->>'amountPence')::bigint then all_settled:=false;end if;
  end loop;
  -- Require invoice totals to match the approved actual cost. A missing invoice must
  -- not turn a partially represented job into a paid work order.
  select * into wo from public.work_orders where id=work_id;
  if (select sum((inv->>'amountPence')::bigint) from jsonb_array_elements(saved.state->'invoices') inv where (inv->>'workOrderId')::bigint=work_id)<>round(wo.actual_cost*100)::bigint then all_settled:=false;end if;
  if all_settled and not wo.is_ongoing then
   select max(s.payment_date)::timestamptz into last_paid from public.supplier_settlements s join public.supplier_settlement_allocations a on a.settlement_id=s.id where a.work_order_id=work_id;
   update public.work_orders set payment_status='Paid',paid_at=last_paid where id=work_id;
  end if;
 end loop;
 return jsonb_build_object('settlementId',request_id,'replayed',false,'workOrderIds',to_jsonb(affected));
end $$;

create or replace function private.guard_settled_creditor_register() returns trigger language plpgsql security definer set search_path='' as $$
declare allocation record;invoice jsonb;old_invoice jsonb;
begin
 if new.area<>'creditors' then return new;end if;
 for allocation in select distinct invoice_id,invoice_snapshot from public.supplier_settlement_allocations where block_id=new.block_id loop
  if (select count(*) from jsonb_array_elements(new.state->'invoices') inv where inv->>'id'=allocation.invoice_id)<>1 then raise exception 'Cannot remove or duplicate an invoice with recorded settlements';end if;
  select inv into invoice from jsonb_array_elements(new.state->'invoices') inv where inv->>'id'=allocation.invoice_id;
  if invoice<>allocation.invoice_snapshot then raise exception 'Cannot change an invoice with recorded settlements';end if;
 end loop;
 for invoice in select inv from jsonb_array_elements(new.state->'invoices') inv loop
  if exists(select 1 from public.work_orders w where w.id=(invoice->>'workOrderId')::bigint and (w.payment_status='Paid' or (w.is_ongoing and w.status in ('Complete','Cancelled')))) then
   select inv into old_invoice from jsonb_array_elements(old.state->'invoices') inv where inv->>'id'=invoice->>'id';
   if old_invoice is null or old_invoice<>invoice then raise exception 'Cannot add or change invoices on an already paid work order';end if;
  end if;
 end loop;
 return new;
end $$;

-- Guard first saves as well as updates after an empty ongoing work order closes.
drop trigger guard_settled_creditor_register on public.management_review_state;
create trigger guard_settled_creditor_register before insert or update on public.management_review_state for each row execute function private.guard_settled_creditor_register();

-- Preserve existing portfolio-scoped work_orders RLS and owner-only settlement RPC.
create or replace function private.guard_ongoing_work_order() returns trigger
language plpgsql security invoker set search_path='' as $$
declare saved jsonb;invoice jsonb;settled bigint;
begin
 if tg_op='UPDATE' then
  if new.is_ongoing is distinct from old.is_ongoing then raise exception 'Work type is fixed when the work order is raised';end if;
  if old.is_ongoing and old.status in ('Complete','Cancelled') and new.status<>old.status then raise exception 'Closed ongoing works cannot be reopened; raise a new work order';end if;
 end if;
 if new.payment_status='Approved' and (tg_op='INSERT' or old.payment_status is distinct from 'Approved') then
  if (not new.is_ongoing and new.status<>'Complete') or (new.is_ongoing and new.status not in ('Open','In progress','On hold')) or new.actual_cost is null or new.actual_cost<=0 then raise exception 'Complete ordinary work, or keep ongoing work active, and enter a positive approved cost before payment approval';end if;
 end if;
 if new.is_ongoing and new.payment_status='Paid' then raise exception 'Ongoing work payments are recorded per invoice, not by marking the contract paid';end if;
 if new.is_ongoing and tg_op='UPDATE' and new.status='Complete' and old.status<>'Complete' then
  select state into saved from public.management_review_state where block_id=new.block_id and area='creditors' for update;
  for invoice in select inv from jsonb_array_elements(coalesce(saved->'invoices','[]'::jsonb)) inv where (inv->>'workOrderId')::bigint=new.id loop
   select coalesce(sum(a.amount_pence),0) into settled from public.supplier_settlement_allocations a where a.work_order_id=new.id and a.block_id=new.block_id and a.invoice_id=invoice->>'id' and a.invoice_snapshot=invoice;
   if settled<(invoice->>'amountPence')::bigint then raise exception 'Settle all saved invoices before closing ongoing works';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.guard_ongoing_work_order() from public,anon,authenticated;
create trigger guard_ongoing_work_order before insert or update on public.work_orders for each row execute function private.guard_ongoing_work_order();
commit;
