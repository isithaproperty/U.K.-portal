"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {useRouter} from "next/navigation";
import {recordedInvoiceSettlement, validateSupplierSettlement, type SupplierSettlementInput, type SupplierSettlementRecord, type SupplierSettlementAllocation} from "../lib/supplier-settlements";
import type { Block, Contractor, WorkOrder } from "./types";
import { money } from "../lib/service-charges";
import { validateCreditorState, addSupplierInvoice, addSupplierPayment, duplicateWorkOrders, poundsToPence, supplierInvoiceBalance, type SupplierInvoice, type SupplierPayment } from "../lib/creditors";

type CreditorProps = { blocks: Block[]; workOrders: WorkOrder[]; contractors: Contractor[]; today: string; reviewOnly?: boolean; canRecordSettlements?: boolean };
export default function CreditorRegister(props: CreditorProps) {
  const [blockId, setBlockId] = useState(props.blocks[0]?.id ?? 0);
  return <><section className="panel unit-select"><label>Creditor block<select value={blockId} onChange={event => { if (confirm("Switch blocks? Unsaved creditor edits will be discarded. Export or save first.")) setBlockId(Number(event.target.value)); }}>{props.blocks.map(block => <option key={block.id} value={block.id}>{block.name}</option>)}</select></label></section><BlockCreditorRegister key={blockId} {...props} blockId={blockId} workOrders={props.workOrders.filter(order => order.blockId === blockId)} /></>;
}
function BlockCreditorRegister({ blocks, workOrders, contractors, today, blockId, reviewOnly = false, canRecordSettlements = false }: CreditorProps & { blockId: number }) {
  const router=useRouter();
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(!reviewOnly);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [savedStateJSON,setSavedStateJSON]=useState("");
  const [settlements,setSettlements]=useState<SupplierSettlementRecord[]>([]);
  const [actualAllocations,setActualAllocations]=useState<SupplierSettlementAllocation[]>([]);
  const [settlementError,setSettlementError]=useState("");
  const [settlementLoading,setSettlementLoading]=useState(!reviewOnly);
  const [settlementSaving,setSettlementSaving]=useState(false);
  const [serverCanRecord,setServerCanRecord]=useState(false);
  const [evidence,setEvidence]=useState("");
  const [uncertain,setUncertain]=useState(false);
  const settlementRequest=useRef<SupplierSettlementInput|null>(null);
  useEffect(()=>{
    if(reviewOnly||!blockId){setSettlementLoading(false);return;}
    const controller=new AbortController();setSettlementLoading(true);setSettlementError("");
    fetch(`/api/blocks/${blockId}/supplier-settlements`,{signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not load actual settlements.");
      if(!controller.signal.aborted){setSettlements(result.settlements);setActualAllocations(result.allocations);setServerCanRecord(result.canRecord===true);
        if(settlementRequest.current&&result.settlements.some((item:SupplierSettlementRecord)=>item.id===settlementRequest.current?.requestId)){settlementRequest.current=null;setUncertain(false);setMessage("The recorded settlement was found in saved history.");}}
    }).catch(error=>{if(!controller.signal.aborted)setSettlementError(error instanceof Error?error.message:"Could not load actual settlements.");}).finally(()=>{if(!controller.signal.aborted)setSettlementLoading(false);});
    return()=>controller.abort();
  },[blockId,reviewOnly,reload]);
  const dirty=JSON.stringify({invoices,payments})!==savedStateJSON;
  async function recordActualSettlement(){
    if(reviewOnly||!canRecordSettlements||!serverCanRecord||settlementSaving||settlementLoading||settlementError||loading||loadError||dirty)return;
    setSettlementSaving(true);setMessage("");
    try{
      if(!settlementRequest.current)settlementRequest.current=validateSupplierSettlement({requestId:crypto.randomUUID(),revision,bankTransactionId:bankReference,paymentDate,amountPence:poundsToPence(paymentAmount),evidence,confirmedActualPayment:confirmed,allocations:[{invoiceId,amountPence:poundsToPence(paymentAmount)}]},today);
      const response=await fetch(`/api/blocks/${blockId}/supplier-settlements`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(settlementRequest.current)});
      const result=await response.json();
      if(!response.ok){if(result.uncertain)setUncertain(true);else{settlementRequest.current=null;setUncertain(false);}throw new Error(result.error||"Settlement was not confirmed.");}
      settlementRequest.current=null;setUncertain(false);setMessage("Actual settlement recorded. Ongoing works remain open; each invoice shows its own payment status. One-off work orders become Paid only when all saved invoices are settled and match the approved actual cost.");setPaymentAmount("");setBankReference("");setEvidence("");setConfirmed(false);setReload(value=>value+1);router.refresh();
    }catch(error){if(settlementRequest.current)setUncertain(true);setMessage(error instanceof Error?error.message:"Settlement outcome is uncertain. Reload saved history before retrying the same request.");}
    finally{setSettlementSaving(false);}
  }
  useEffect(() => {
    if (reviewOnly || !blockId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    fetch(`/api/blocks/${blockId}/management-review/creditors`, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load creditor records.");
      const state = result.state === null ? { invoices: [], payments: [] } : validateCreditorState(result.state, workOrders, blockId, today);
      if (!controller.signal.aborted) { setInvoices(state.invoices); setPayments(state.payments); setRevision(result.revision); setSavedStateJSON(JSON.stringify(state)); setStorageMessage(""); }
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load creditor records."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Block changes remount this component; scoped order data is captured for that block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, reviewOnly, reload]);
  async function saveRegister() {
    if (reviewOnly || saving || loading || loadError || settlementSaving || uncertain) return;
    setSaving(true); setStorageMessage("");
    try {
      const state = validateCreditorState({ invoices, payments }, workOrders, blockId, today);
      const response = await fetch(`/api/blocks/${blockId}/management-review/creditors`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "Another manager updated this register. Export your edits, then reload saved records before trying again." : result.error || "Could not save creditor records.");
      setInvoices(state.invoices); setPayments(state.payments); setRevision(result.revision); setSavedStateJSON(JSON.stringify(state)); setStorageMessage("Creditor register saved for this block.");
    } catch (error) { setStorageMessage(error instanceof Error ? error.message : "Could not save creditor records."); }
    finally { setSaving(false); }
  }
  const [orderId, setOrderId] = useState("");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [invoiceId, setInvoiceId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [bankReference, setBankReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const invoiceRequest = useRef<string | null>(null);
  const paymentRequest = useRef<string | null>(null);
  const duplicates = useMemo(() => duplicateWorkOrders(workOrders), [workOrders]);
  const order = workOrders.find(item => item.id === Number(orderId));
  function exportDrafts() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ mode: reviewOnly ? "review-only" : "creditor-register", blockId, exportedAt: new Date().toISOString(), invoices, payments, settlements, actualAllocations }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "creditor-review.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <section>
    <div className="page-head"><div><p className="eyebrow">CREDITORS · REVIEW</p><h1>Supplier invoices & payments</h1><p>Match invoices to work orders and reconcile actual payment evidence.</p></div><button className="unit-secondary" onClick={exportDrafts} disabled={!invoices.length}>Export draft register</button></div>
    <p className="clean-notice">{reviewOnly ? "Demo workspace: changes stay in this tab only. Export before leaving." : "Edit this block’s supplier invoice register, then save explicitly. Owner-verified actual bank settlements determine invoice and work-order paid status. Editable review payment drafts do not count as actual settlement."}</p>
    {!reviewOnly && <section className="panel tenant-card"><button className="primary" disabled={saving || loading || !!loadError || !blockId || settlementSaving || uncertain} onClick={() => void saveRegister()}>{saving ? "Saving…" : "Save creditor register"}</button> <button className="unit-secondary" disabled={loading || saving || settlementSaving} onClick={() => { if (confirm("Discard unsaved creditor edits and reload saved records?")) setReload(value => value + 1); }}>Reload saved records</button>{loading && <p role="status">Loading creditor records…</p>}{loadError && <p role="alert">{loadError} Save is disabled until records load successfully.</p>}{storageMessage && <p role="status">{storageMessage}</p>}</section>}
    <fieldset disabled={loading || saving || !!loadError || settlementSaving} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}>
    <section className="panel tenant-card"><h2>Possible duplicate work orders</h2><p>Matching block, unit, supplier and normalized title. Review the job scope and dates before deciding whether these are duplicates; recurring work can match. No work orders are removed.</p>{duplicates.length ? duplicates.map(group => <article key={group[0].id}><h3>{blocks.find(block => block.id === group[0].blockId)?.name} · {group[0].title}</h3><ul>{group.map(item => <li key={item.id}>{item.workOrderNumber} · {item.status} · {item.createdAt.slice(0, 10)} · {item.contractor || "Supplier unassigned"}</li>)}</ul></article>) : <p>No exact normalized matches in the accessible work orders.</p>}</section>
    <div className="tenant-grid">
      <section className="panel tenant-card tenant-form"><h2>Prepare supplier invoice</h2><form onSubmit={event => {
        event.preventDefault();
        try {
          if (!order?.contractorId) throw new Error("The work order needs an assigned supplier before linking an invoice.");
          invoiceRequest.current ??= crypto.randomUUID();
          const candidate: SupplierInvoice = { id: invoiceRequest.current, workOrderId: order.id, contractorId: order.contractorId, number: number.trim(), amountPence: poundsToPence(amount), invoiceDate, dueDate };
          const next = addSupplierInvoice(invoices, candidate, workOrders); setInvoices(next); setMessage("Invoice linked. Save the creditor register to retain this change."); setNumber(""); setAmount(""); invoiceRequest.current = null;
        } catch (error) { setMessage(error instanceof Error ? error.message : "Could not prepare invoice."); }
      }}>
        <label>Work order<select required value={orderId} onChange={event => { setOrderId(event.target.value); invoiceRequest.current = null; }}><option value="">Choose a work order</option>{workOrders.filter(item => item.contractorId).map(item => <option value={item.id} key={item.id}>{item.workOrderNumber} · {blocks.find(block => block.id === item.blockId)?.name} · {item.title}</option>)}</select></label>
        {order && <p>Supplier: {contractors.find(item => item.id === order.contractorId)?.companyName || order.contractor || `Supplier ${order.contractorId}`}</p>}
        <label>Supplier invoice number<input required maxLength={100} value={number} onChange={event => setNumber(event.target.value)} /></label>
        <label>Invoice total (£)<input required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>Invoice date<input required type="date" value={invoiceDate} onChange={event => setInvoiceDate(event.target.value)} /></label>
        <label>Due date<input required type="date" min={invoiceDate} value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
        <button className="primary" disabled={!order?.contractorId}>Add to review register</button>
      </form></section>
      <section className="panel tenant-card tenant-form"><h2>{reviewOnly?"Review a recorded payment":"Record actual supplier settlement"}</h2><p>Use a uniquely identified actual bank transaction. Approval or a planned payment does not mean paid.</p>
      {!reviewOnly&&<><p>Only the portfolio owner may confirm payments. Save invoice edits before allocating a settlement. Ongoing works stay open across invoices and payments until explicitly closed. Their payment status is tracked per invoice. One-off linked invoices must total the approved actual cost before the work order becomes Paid.</p>{settlementLoading&&<p role="status">Loading actual settlement history…</p>}{settlementError&&<p role="alert">{settlementError}</p>}{dirty&&<p>Save or reload invoice edits before recording payment.</p>}{uncertain&&<p role="alert">The last outcome is uncertain. Reload saved history first. A retry reuses the exact request and bank transaction identifier.</p>}</>}
      <form onSubmit={event => {
        event.preventDefault();
        if(!reviewOnly){void recordActualSettlement();return;}
        try {
          if (!confirmed) throw new Error("Confirm actual payment evidence first.");
          paymentRequest.current ??= crypto.randomUUID();
          const candidate: SupplierPayment = { id: paymentRequest.current, invoiceId, amountPence: poundsToPence(paymentAmount), paymentDate, bankReference: bankReference.trim() };
          const next = addSupplierPayment(payments, candidate, invoices, today); setPayments(next); setMessage("Payment evidence allocated. Save the creditor register to retain this change."); setPaymentAmount(""); setBankReference(""); setConfirmed(false); paymentRequest.current = null;
        } catch (error) { setMessage(error instanceof Error ? error.message : "Could not allocate payment."); }
      }}>
        <fieldset disabled={!reviewOnly&&(uncertain||!canRecordSettlements||!serverCanRecord||settlementLoading||!!settlementError)} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <label>Invoice<select required value={invoiceId} onChange={event => { setInvoiceId(event.target.value); paymentRequest.current = null; }}><option value="">Choose an invoice</option>{invoices.map(item => <option key={item.id} value={item.id}>{item.number} · {money((reviewOnly?supplierInvoiceBalance(item, payments, today):recordedInvoiceSettlement(item.id,item.amountPence,actualAllocations)).outstandingPence)} outstanding</option>)}</select></label>
        <label>Amount allocated (£)<input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /></label>
        <label>Actual payment date<input required type="date" max={today} value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label>
        <label>Unique bank transaction ID<input required maxLength={200} value={bankReference} onChange={event => setBankReference(event.target.value)} /></label>
        {!reviewOnly&&<label>Actual payment evidence<textarea required minLength={5} maxLength={5000} value={evidence} onChange={event=>setEvidence(event.target.value)} placeholder="Bank statement / transaction evidence checked by the owner"/></label>}
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I checked evidence that this payment was made.</label>
        <button className="primary" disabled={!invoiceId || !confirmed || (!reviewOnly&&(!canRecordSettlements||!serverCanRecord||dirty||settlementLoading||!!settlementError||settlementSaving||uncertain))}>{reviewOnly?"Add allocation to review":"Record verified actual settlement"}</button>
        </fieldset>
        {!reviewOnly&&uncertain&&<button type="button" className="unit-secondary" disabled={settlementLoading||settlementSaving||!!settlementError} onClick={()=>void recordActualSettlement()}>Retry the same settlement request</button>}
      </form></section>
    </div>
    {message && <p role="status" className="unit-message">{message}</p>}
    <section className="panel tenant-card"><h2>Invoice register</h2><div className="block-table-wrap"><table><thead><tr><th>Invoice / supplier</th><th>Work order</th><th>Total</th><th>Allocated</th><th>Outstanding</th><th>{reviewOnly?"Review status":"Recorded settlement status"}</th></tr></thead><tbody>{invoices.map(invoice => {
      const unavailable=!reviewOnly&&(settlementLoading||!!settlementError);
      const balance = reviewOnly?supplierInvoiceBalance(invoice, payments, today):recordedInvoiceSettlement(invoice.id,invoice.amountPence,actualAllocations), linkedOrder = workOrders.find(item => item.id === invoice.workOrderId);
      return <tr key={invoice.id} style={!unavailable&&balance.status === "Paid" ? { background: "#e7f2e9" } : undefined}><td>{invoice.number}<br /><small>{contractors.find(item => item.id === invoice.contractorId)?.companyName || linkedOrder?.contractor}</small></td><td>{linkedOrder?.workOrderNumber} · {linkedOrder?.title}</td><td>{money(invoice.amountPence)}</td><td>{unavailable?"—":money(balance.paidPence)}</td><td>{unavailable?"—":money(balance.outstandingPence)}</td><td><strong>{unavailable?"Settlement history unavailable":balance.status}</strong></td></tr>;
    })}{!invoices.length && <tr><td colSpan={6}>No supplier invoices yet.</td></tr>}</tbody></table></div>
    {payments.length > 0 && <details><summary>Legacy / draft payment notes (not actual settlement)</summary><ul>{payments.map(payment => <li key={payment.id}>{invoices.find(invoice => invoice.id === payment.invoiceId)?.number} · {payment.paymentDate} · {money(payment.amountPence)} · {payment.bankReference}</li>)}</ul></details>}</section>
    {!reviewOnly&&<section className="panel tenant-card"><h2>Immutable actual settlement history</h2>{settlements.length?<ul>{settlements.map(item=><li key={item.id}>{item.payment_date} · {money(item.amount_pence)} · {item.bank_transaction_id}<p>{item.evidence}</p><small>Recorded by {item.recorded_by} · {item.recorded_at}</small></li>)}</ul>:<p>No actual settlements recorded for this block.</p>}</section>}
    </fieldset>
  </section>;
}
