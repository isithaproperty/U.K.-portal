-- REVIEW ONLY; not installed. Requires bank_reconciliation.sql, building_cashflow.sql,
-- management_review.sql and supplier_settlements.sql. No payment instruction is sent.
create table public.bank_contractor_reconciliations (
 cashflow_row_id bigint primary key references public.building_cashflow_rows(id),
 block_id bigint not null references public.blocks(id),
 settlement_id uuid not null unique references public.supplier_settlements(id),
 approved_by text not null,
 approved_at timestamptz not null default now()
);
alter table public.bank_contractor_reconciliations enable row level security;
revoke all on public.bank_contractor_reconciliations from public,anon,authenticated;
grant select on public.bank_contractor_reconciliations to authenticated;
create policy "scoped staff read reconciliation links" on public.bank_contractor_reconciliations for select to authenticated using (
 exists(select 1 from public.blocks b join public.portal_members m on m.email=lower(auth.jwt()->>'email') where b.id=block_id and (m.role in ('owner','admin') or (m.role='manager' and nullif(m.portfolio_manager,'')=b.manager)))
);
-- One transaction, two distinct views of the same statement: observations plus receipts.
-- Existing cashflow fingerprints are reused, so separate cashflow imports do not double-count.
create or replace function public.stage_block_statement(p_block_id bigint,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare observations jsonb;receipts jsonb;incoming jsonb;
begin
 observations:=public.stage_building_cashflow(p_block_id,p_rows);
 select coalesce(jsonb_agg(value),'[]'::jsonb) into incoming from jsonb_array_elements(p_rows) where (value->>'amount_pence')::bigint>0;
 receipts:=jsonb_build_object('added',0,'duplicates',0);
 if jsonb_array_length(incoming)>0 then receipts:=public.stage_bank_statement(p_block_id,incoming);end if;
 return receipts||jsonb_build_object('cashflowAdded',observations->'added','cashflowDuplicates',observations->'duplicates');
end $$;
revoke all on function public.stage_block_statement(bigint,jsonb) from public,anon;
grant execute on function public.stage_block_statement(bigint,jsonb) to authenticated;

create or replace function private.approve_block_statement(p_block_id bigint,p_residents jsonb,p_contractors jsonb,p_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb;bankrow public.building_cashflow_rows%rowtype;saved public.management_review_state%rowtype;
 wo public.work_orders%rowtype;invoice jsonb;remaining bigint;settlement uuid;request jsonb;result jsonb;
 posted integer:=0;reconciled integer:=0;matches integer;outstanding_count integer;
begin
 if auth.uid() is null or not exists(select 1 from public.blocks b join public.portal_members m on m.email=lower(auth.jwt()->>'email') where b.id=p_block_id and (m.role in ('owner','admin') or (m.role='manager' and nullif(m.portfolio_manager,'')=b.manager))) then raise exception 'Block access required' using errcode='42501';end if;
 if jsonb_typeof(p_residents) is distinct from 'array' or jsonb_typeof(p_contractors) is distinct from 'array' or jsonb_array_length(p_residents)+jsonb_array_length(p_contractors) not between 1 and 1000 then raise exception 'Select 1 to 1000 transactions';end if;
 if jsonb_array_length(p_contractors)>0 then
  if p_confirmed is distinct from true then raise exception 'Confirm bank evidence and saved invoices';end if;
  if not exists(select 1 from public.portal_members where email=lower(auth.jwt()->>'email') and role='owner') then raise exception 'Owner access required for contractor settlements' using errcode='42501';end if;
  select * into saved from public.management_review_state where block_id=p_block_id and area='creditors' for update;
  if not found or saved.revision is distinct from p_revision or jsonb_typeof(saved.state->'invoices') is distinct from 'array' then raise exception 'Creditor register changed or unavailable; reload before approval';end if;
 end if;
 -- Same ordering as legacy supplier settlement: creditor register, then work orders.
 for item in select value from jsonb_array_elements(p_contractors) order by (value->>'id')::bigint loop
  select * into bankrow from public.building_cashflow_rows where id=(item->>'id')::bigint and block_id=p_block_id for update;
  if not found or bankrow.amount_pence>=0 then raise exception 'Outgoing statement transaction unavailable';end if;
  if exists(select 1 from public.bank_contractor_reconciliations where cashflow_row_id=bankrow.id) then
   if not exists(select 1 from public.bank_contractor_reconciliations l join public.supplier_settlement_allocations a on a.settlement_id=l.settlement_id where l.cashflow_row_id=bankrow.id and a.invoice_id=item->>'invoiceId') then raise exception 'Already approved with another invoice';end if;
   continue;
  end if;
  if nullif(btrim(bankrow.transaction_id),'') is null or bankrow.transaction_date>(now() at time zone 'Europe/London')::date then raise exception 'Valid dated bank transaction ID required; review manually';end if;
  select count(*) into matches from public.work_orders w where w.block_id=p_block_id and upper(w.work_order_number)=any(regexp_split_to_array(upper(bankrow.bank_reference||' '||bankrow.description),'[^A-Z0-9/._-]+'));
  if matches<>1 then raise exception 'Exactly one work order reference in this block is required';end if;
  select * into wo from public.work_orders w where w.block_id=p_block_id and upper(w.work_order_number)=any(regexp_split_to_array(upper(bankrow.bank_reference||' '||bankrow.description),'[^A-Z0-9/._-]+')) for update;
  if wo.status<>'Complete' or wo.payment_status<>'Approved' or wo.actual_cost is null or wo.actual_cost<=0 then raise exception 'Complete and approve work order before reconciling';end if;
  if (select sum((x->>'amountPence')::bigint) from jsonb_array_elements(saved.state->'invoices') x where (x->>'workOrderId')::bigint=wo.id) is distinct from round(wo.actual_cost*100)::bigint then raise exception 'Saved invoice totals must equal approved actual cost';end if;
  if exists(select 1 from jsonb_array_elements(saved.state->'invoices') x where (x->>'workOrderId')::bigint=wo.id and ((x->>'contractorId')::bigint is distinct from wo.contractor_id or (x->>'amountPence')::bigint<=0)) then raise exception 'Saved invoice supplier or amount invalid';end if;
  select count(*) into outstanding_count from jsonb_array_elements(saved.state->'invoices') x where (x->>'workOrderId')::bigint=wo.id and (x->>'amountPence')::bigint>(select coalesce(sum(a.amount_pence),0) from public.supplier_settlement_allocations a where a.block_id=p_block_id and a.invoice_id=x->>'id');
  if outstanding_count<>1 then raise exception 'Multiple or no outstanding invoices require manual allocation';end if;
  if (select count(*) from jsonb_array_elements(saved.state->'invoices') x where x->>'id'=item->>'invoiceId' and (x->>'workOrderId')::bigint=wo.id)<>1 then raise exception 'Invoice does not uniquely match work order';end if;
  select x into invoice from jsonb_array_elements(saved.state->'invoices') x where x->>'id'=item->>'invoiceId' and (x->>'workOrderId')::bigint=wo.id;
  select (invoice->>'amountPence')::bigint-coalesce(sum(a.amount_pence),0) into remaining from public.supplier_settlement_allocations a where a.block_id=p_block_id and a.invoice_id=invoice->>'id';
  if -bankrow.amount_pence>remaining then raise exception 'Transaction exceeds outstanding invoice';end if;
  settlement:=gen_random_uuid();
  request:=jsonb_build_object('requestId',settlement,'revision',p_revision,'bankTransactionId',lower(btrim(bankrow.transaction_id)),'paymentDate',bankrow.transaction_date,'amountPence',-bankrow.amount_pence,'evidence','Reviewed block statement row '||bankrow.id||': '||bankrow.bank_reference||' '||bankrow.description,'confirmedActualPayment',true,'allocations',jsonb_build_array(jsonb_build_object('invoiceId',invoice->>'id','amountPence',-bankrow.amount_pence)));
  result:=private.record_supplier_settlement(p_block_id,request);
  insert into public.bank_contractor_reconciliations(cashflow_row_id,block_id,settlement_id,approved_by) values(bankrow.id,p_block_id,settlement,lower(auth.jwt()->>'email'));
  reconciled:=reconciled+1;
 end loop;
 if jsonb_array_length(p_residents)>0 then posted:=public.post_bank_payments(p_block_id,p_residents);end if;
 return jsonb_build_object('residentsPosted',posted,'contractorsReconciled',reconciled);
end $$;
revoke all on function private.approve_block_statement(bigint,jsonb,jsonb,bigint,boolean) from public,anon;
grant execute on function private.approve_block_statement(bigint,jsonb,jsonb,bigint,boolean) to authenticated;
create or replace function public.approve_block_statement(p_block_id bigint,p_residents jsonb,p_contractors jsonb,p_revision bigint,p_confirmed boolean) returns jsonb language sql security invoker set search_path='' as $$select private.approve_block_statement(p_block_id,p_residents,p_contractors,p_revision,p_confirmed)$$;
revoke all on function public.approve_block_statement(bigint,jsonb,jsonb,bigint,boolean) from public,anon;
grant execute on function public.approve_block_statement(bigint,jsonb,jsonb,bigint,boolean) to authenticated;
