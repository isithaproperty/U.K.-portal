/** Actual outgoing bank evidence is independent of editable creditor-review payment drafts. */
export type SettlementAllocation = { invoiceId: string; amountPence: number };
export type SupplierSettlementInput = {
 requestId: string; revision: number; bankTransactionId: string; paymentDate: string;
 amountPence: number; evidence: string; confirmedActualPayment: true; allocations: SettlementAllocation[];
};
export type SupplierSettlementRecord = {
 id: string; block_id: number; bank_transaction_id: string; payment_date: string;
 amount_pence: number; evidence: string; recorded_by: string; recorded_at: string;
};
export type SupplierSettlementAllocation = { settlement_id: string; invoice_id: string; amount_pence: number; work_order_id: number };
export function validateSupplierSettlement(value: unknown, today: string): SupplierSettlementInput {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide a settlement request.");
 const raw=value as Record<string,unknown>;
 if(typeof raw.requestId!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.requestId))throw new Error("A stable settlement request UUID is required.");
 if(!Number.isSafeInteger(raw.revision)||(raw.revision as number)<1)throw new Error("Save and reload the creditor register before recording settlement.");
 if(typeof raw.bankTransactionId!=="string"||!raw.bankTransactionId.trim()||raw.bankTransactionId.length>200||/[\r\n\u0000]/.test(raw.bankTransactionId))throw new Error("Enter a unique bank transaction identifier.");
 if(typeof raw.evidence!=="string"||raw.evidence.trim().length<5||raw.evidence.length>5000)throw new Error("Record the actual payment evidence checked by the owner.");
 if(raw.confirmedActualPayment!==true)throw new Error("The owner must confirm actual payment evidence.");
 if(typeof raw.paymentDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(raw.paymentDate)||!Number.isFinite(Date.parse(`${raw.paymentDate}T00:00:00Z`))||new Date(`${raw.paymentDate}T00:00:00Z`).toISOString().slice(0,10)!==raw.paymentDate||raw.paymentDate>today)throw new Error("Use the actual payment date, on or before today.");
 if(!Number.isSafeInteger(raw.amountPence)||(raw.amountPence as number)<=0||(raw.amountPence as number)>100_000_000)throw new Error("Settlement amount must be positive integer pence within the supported limit.");
 if(!Array.isArray(raw.allocations)||!raw.allocations.length||raw.allocations.length>100)throw new Error("Allocate the payment to 1–100 saved invoices.");
 const seen=new Set<string>();
 const allocations=raw.allocations.map(value=>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid payment allocation.");
  const item=value as Record<string,unknown>;
  if(typeof item.invoiceId!=="string"||!item.invoiceId.trim()||item.invoiceId.length>200||seen.has(item.invoiceId)||!Number.isSafeInteger(item.amountPence)||(item.amountPence as number)<=0)throw new Error("Allocation identifiers must be unique and amounts positive integer pence.");
  seen.add(item.invoiceId);return {invoiceId:item.invoiceId,amountPence:item.amountPence as number};
 });
 if(allocations.reduce((sum,item)=>sum+item.amountPence,0)!==raw.amountPence)throw new Error("Allocations must exactly equal the recorded transaction amount.");
 return {requestId:raw.requestId.toLowerCase(),revision:raw.revision as number,bankTransactionId:raw.bankTransactionId.trim().toLowerCase(),paymentDate:raw.paymentDate,amountPence:raw.amountPence as number,evidence:raw.evidence.trim(),confirmedActualPayment:true,allocations};
}
export function recordedInvoiceSettlement(invoiceId: string, amountPence: number, allocations: SupplierSettlementAllocation[]) {
 const paidPence=allocations.filter(item=>item.invoice_id===invoiceId).reduce((sum,item)=>sum+item.amount_pence,0);
 return {paidPence,outstandingPence:Math.max(0,amountPence-paidPence),status:paidPence>=amountPence?"Paid":paidPence>0?"Part paid":"Unpaid"} as const;
}
