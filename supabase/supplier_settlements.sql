-- REVIEW ONLY. Requires management_review.sql and existing work_orders workflow columns.
-- No seed records, bank transfers, supplier emails, or expected-payment automations.
create schema if not exists private;
create table public.supplier_settlements (
 id uuid primary key,
 block_id bigint not null references public.blocks(id),
 bank_transaction_id text not null unique check(length(bank_transaction_id) between 1 and 200 and bank_transaction_id=lower(btrim(bank_transaction_id))),
 payment_date date not null,
 amount_pence bigint not null check(amount_pence between 1 and 100000000),
 evidence text not null check(length(btrim(evidence)) between 5 and 5000),
 request_snapshot jsonb not null,
 recorded_by text not null,
 recorded_at timestamptz not null default now(),
 unique(id,block_id)
);
create table public.supplier_settlement_allocations (
 settlement_id uuid not null,
 block_id bigint not null,
 invoice_id text not null check(length(invoice_id) between 1 and 200),
 work_order_id bigint not null references public.work_orders(id),
 amount_pence bigint not null check(amount_pence>0),
 invoice_snapshot jsonb not null,
 primary key(settlement_id,invoice_id),
 foreign key(settlement_id,block_id) references public.supplier_settlements(id,block_id)
);
create index supplier_allocations_block_invoice_idx on public.supplier_settlement_allocations(block_id,invoice_id);
create index supplier_allocations_work_order_idx on public.supplier_settlement_allocations(work_order_id);
alter table public.supplier_settlements enable row level security;
alter table public.supplier_settlement_allocations enable row level security;
revoke all on public.supplier_settlements,public.supplier_settlement_allocations from public,anon,authenticated;
grant select on public.supplier_settlements,public.supplier_settlement_allocations to authenticated;
create policy "scoped managers read supplier settlements" on public.supplier_settlements for select to authenticated using(
 exists(select 1 from public.portal_members m join public.blocks b on b.id=block_id where m.email=lower((select auth.jwt()->>'email')) and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))
);
create policy "scoped managers read supplier allocations" on public.supplier_settlement_allocations for select to authenticated using(
 exists(select 1 from public.supplier_settlements s where s.id=settlement_id and s.block_id=supplier_settlement_allocations.block_id)
);
-- SECURITY DEFINER is limited to this private write boundary. Exposed tables remain
-- read-only even to owners, so ordinary REST inserts cannot bypass transaction checks.
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
  if not found or wo.contractor_id is distinct from (invoice->>'contractorId')::bigint or wo.status<>'Complete' or wo.payment_status not in ('Approved','Paid') then raise exception 'Complete and approve the correct supplier work order before recording payment';end if;
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
  if all_settled then
   select max(s.payment_date)::timestamptz into last_paid from public.supplier_settlements s join public.supplier_settlement_allocations a on a.settlement_id=s.id where a.work_order_id=work_id;
   update public.work_orders set payment_status='Paid',paid_at=last_paid where id=work_id;
  end if;
 end loop;
 return jsonb_build_object('settlementId',request_id,'replayed',false,'workOrderIds',to_jsonb(affected));
end $$;
revoke all on function private.record_supplier_settlement(bigint,jsonb) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.record_supplier_settlement(bigint,jsonb) to authenticated;
create or replace function public.record_supplier_settlement(p_block_id bigint,p_request jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.record_supplier_settlement(p_block_id,p_request); $$;
revoke all on function public.record_supplier_settlement(bigint,jsonb) from public,anon;
grant execute on function public.record_supplier_settlement(bigint,jsonb) to authenticated;
-- Keep durable invoice identities and amounts immutable once money is allocated.
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
  if exists(select 1 from public.work_orders w where w.id=(invoice->>'workOrderId')::bigint and w.payment_status='Paid') then
   select inv into old_invoice from jsonb_array_elements(old.state->'invoices') inv where inv->>'id'=invoice->>'id';
   if old_invoice is null or old_invoice<>invoice then raise exception 'Cannot add or change invoices on an already paid work order';end if;
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.guard_settled_creditor_register() from public,anon,authenticated;
create trigger guard_settled_creditor_register before update on public.management_review_state for each row execute function private.guard_settled_creditor_register();
-- Reject direct arbitrary Paid toggles, including browser REST updates.
create or replace function private.guard_work_order_settlement() returns trigger language plpgsql security invoker set search_path='' as $$
declare saved jsonb;invoice jsonb;invoice_total bigint:=0;settled bigint;latest timestamptz;
begin
 if tg_op='INSERT' then
  if new.payment_status='Paid' then raise exception 'New work orders cannot be marked paid without recorded supplier settlements';end if;
  return new;
 end if;
 if exists(select 1 from public.supplier_settlement_allocations a where a.work_order_id=old.id) and (new.actual_cost is distinct from old.actual_cost or new.contractor_id is distinct from old.contractor_id or new.block_id<>old.block_id) then raise exception 'Work orders with actual settlements require an audited financial correction';end if;
 if old.payment_status='Paid' and exists(select 1 from public.supplier_settlement_allocations a where a.work_order_id=old.id) and (new.actual_cost is distinct from old.actual_cost or new.contractor_id is distinct from old.contractor_id or new.block_id<>old.block_id or new.payment_status<>old.payment_status or new.status<>old.status or new.paid_at is distinct from old.paid_at) then raise exception 'Paid work orders require a separate audited correction workflow';end if;
 if new.payment_status='Paid' and old.payment_status is distinct from 'Paid' then
  if auth.uid() is null or not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role='owner') then raise exception 'Owner access required' using errcode='42501';end if;
  if old.payment_status is distinct from 'Approved' or new.status<>'Complete' or new.actual_cost is null then raise exception 'Complete and approve before settlement';end if;
  select state into saved from public.management_review_state where block_id=new.block_id and area='creditors' for update;
  if saved is null or jsonb_typeof(saved->'invoices') is distinct from 'array' then raise exception 'Saved supplier invoices required';end if;
  for invoice in select inv from jsonb_array_elements(saved->'invoices') inv where (inv->>'workOrderId')::bigint=new.id loop
   if (invoice->>'contractorId')::bigint is distinct from new.contractor_id then raise exception 'Settled invoice supplier must match the work order';end if;
   invoice_total:=invoice_total+(invoice->>'amountPence')::bigint;
   select coalesce(sum(a.amount_pence),0) into settled from public.supplier_settlement_allocations a where a.block_id=new.block_id and a.invoice_id=invoice->>'id' and a.work_order_id=new.id and a.invoice_snapshot=invoice;
   if settled<(invoice->>'amountPence')::bigint then raise exception 'Every linked invoice must have recorded actual settlement';end if;
  end loop;
  if invoice_total<=0 or invoice_total<>round(new.actual_cost*100)::bigint then raise exception 'Settled invoice totals must match approved actual cost';end if;
  select max(s.payment_date)::timestamptz into latest from public.supplier_settlements s join public.supplier_settlement_allocations a on a.settlement_id=s.id where a.work_order_id=new.id;
  if latest is null then raise exception 'Recorded actual supplier settlement required';end if;
  new.paid_at:=latest;
 end if;
 return new;
end $$;
revoke all on function private.guard_work_order_settlement() from public,anon,authenticated;
create trigger guard_work_order_settlement before insert or update on public.work_orders for each row execute function private.guard_work_order_settlement();
