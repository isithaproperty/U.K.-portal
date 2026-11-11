/** Suggestions only. Approval rechecks authoritative records inside one database transaction. */
export type ContractorBankRow={id:number;block_id:number;transaction_date:string;amount_pence:number;bank_reference:string;description:string;transaction_id:string;source_file:string};
export type ReconciliationOrder={id:number;block_id:number;work_order_number:string;contractor_id:number|null;status:string;payment_status:string;actual_cost:number|null};
export type ReconciliationInvoice={id:string;workOrderId:number;contractorId:number;number:string;amountPence:number};
export type ContractorSuggestion={invoiceId:string|null;workOrderId:number|null;workOrderNumber:string|null;invoiceNumber:string|null;outstandingPence:number|null;reason:string};
export function referenceContains(text:string,reference:string){
 return !!reference.trim()&&text.toUpperCase().split(/[^A-Z0-9/._-]+/).includes(reference.toUpperCase());
}
export function suggestContractor(row:ContractorBankRow,orders:ReconciliationOrder[],invoices:ReconciliationInvoice[],allocations:{invoice_id:string;amount_pence:number}[],recordedBankIds:string[],today:string):ContractorSuggestion{
 const none=(reason:string):ContractorSuggestion=>({invoiceId:null,workOrderId:null,workOrderNumber:null,invoiceNumber:null,outstandingPence:null,reason});
 if(row.amount_pence>=0)return none('Not an outgoing transaction');
 if(!row.transaction_id.trim())return none('Missing bank transaction ID: manual evidence review required');
 if(row.transaction_date>today)return none('Future-dated transaction: review required');
 if(recordedBankIds.includes(row.transaction_id.trim().toLowerCase()))return none('Bank transaction already recorded: verify existing settlement');
 const matched=orders.filter(o=>o.block_id===row.block_id&&referenceContains(`${row.bank_reference} ${row.description}`,o.work_order_number));
 if(matched.length!==1)return none(matched.length?'Multiple work orders: manual review required':'No work order reference match');
 const order=matched[0];
 if(order.status!=='Complete'||order.payment_status!=='Approved')return none('Work order must be completed and payment approved');
 const linked=invoices.filter(i=>i.workOrderId===order.id);
 if(!linked.length||linked.some(i=>i.contractorId!==order.contractor_id||!Number.isSafeInteger(i.amountPence)||i.amountPence<=0)||new Set(linked.map(i=>i.id)).size!==linked.length)return none('Saved supplier invoices must be verified against this work order');
 if(!order.actual_cost||linked.reduce((n,i)=>n+i.amountPence,0)!==Math.round(Number(order.actual_cost)*100))return none('Invoice total differs from approved actual cost');
 const outstanding=linked.map(i=>({invoice:i,remaining:i.amountPence-allocations.filter(a=>a.invoice_id===i.id).reduce((n,a)=>n+a.amount_pence,0)})).filter(i=>i.remaining>0);
 if(outstanding.length!==1)return none('Multiple or no outstanding invoices: manual allocation required');
 const {invoice,remaining}=outstanding[0];
 if(-row.amount_pence>remaining)return none('Outgoing amount exceeds outstanding invoice: review required');
 return {invoiceId:invoice.id,workOrderId:order.id,workOrderNumber:order.work_order_number,invoiceNumber:invoice.number,outstandingPence:remaining,reason:-row.amount_pence===remaining?'WO and invoice matched: verify evidence before approval':'Partial payment: invoice will remain part paid'};
}
