import {financialDraftToLedgerRows,validateFinancialState,type FinancialPlanningState} from "./financial-planning.ts";
import type {ChargeDocumentSettings} from "./service-charge-document.ts";
import {standardPaymentTerms} from "./service-charge-document.ts";
import {serviceChargeRights} from "./service-charge-rights.ts";
export type FinancialDocumentSettings=ChargeDocumentSettings&{landlordAddress?:string;financialWordingReviewed?:boolean};
export type DocumentUnit={id:number;blockId:number;unitNumber:string;paymentReference?:string|null};
export type DocumentLedgerEntry={request_id:string|null;reference:string;unit_id:number;entry_type:string;description:string;amount_pence:number;entry_date:string;due_date:string|null};
export type FinancialDocumentInput={
 state:FinancialPlanningState;revision:number;today:string;mode:"Draft"|"Issue";
 block:{id:number;name:string;address:string;managementCompany:string};units:DocumentUnit[];
 settings?:FinancialDocumentSettings|null;ledgerEntries?:DocumentLedgerEntry[];
 documentReview?:{landlordAddress:string;wordingApproved:boolean;paymentInstructions?:string};
};
export type FinancialDocumentSnapshot={
 documentId:string;contentHash:string;kind:"Demand"|"Credit note";status:"Draft"|"Ready for issue";
 blockId:number;unitId:number;batchId:string;savedRevision:number;posted:boolean;
 missingRequirements:readonly string[];ledgerReferences:readonly string[];
 subject:string;body:string;html:string;
 attachment:Readonly<{fileName:string;mediaType:"text/plain";encoding:"utf8";content:string}>;
};
const pounds=(pence:number)=>`£${(pence/100).toFixed(2)}`;
export function escapeDocumentHtml(value:string){return value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));}
const present=(value:unknown):value is string=>typeof value==="string"&&!!value.trim();
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");}
/** Read-only generator. It neither posts ledger entries nor queues/sends communications. */
export async function generateFinancialDocuments(input:FinancialDocumentInput):Promise<readonly Readonly<FinancialDocumentSnapshot>[]>{
 if(!["Draft","Issue"].includes(input.mode)||!Number.isSafeInteger(input.revision)||input.revision<1)throw new Error("Choose a saved revision and document mode.");
 const units=input.units.filter(unit=>unit.blockId===input.block.id);
 if(new Set(units.map(unit=>unit.id)).size!==units.length)throw new Error("Duplicate unit scope.");
 const state=validateFinancialState(input.state,input.block.id,units.map(unit=>unit.id),input.today);
 if(!state.prepared)throw new Error("Save a prepared financial batch before generating documents.");
 const batch=state.prepared;
 const ledgerInputs=await financialDraftToLedgerRows(batch.input,units,true);
 const rows=batch.rows;
 if(input.documentReview&&(typeof input.documentReview.landlordAddress!=="string"||input.documentReview.landlordAddress.length>1500||typeof input.documentReview.wordingApproved!=="boolean"||(input.documentReview.paymentInstructions!==undefined&&(typeof input.documentReview.paymentInstructions!=="string"||input.documentReview.paymentInstructions.length>3000))))throw new Error("Invalid document review details.");
 const settings=input.documentReview?{...input.settings,landlordAddress:input.documentReview.landlordAddress,financialWordingReviewed:input.documentReview.wordingApproved,...(input.documentReview.paymentInstructions!==undefined?{paymentText:input.documentReview.paymentInstructions}:{})}:input.settings;
 const demand=batch.input.kind==="Demand";
 const snapshots=await Promise.all([...new Set(rows.map(row=>row.unitId))].map(async unitId=>{
  const unit=units.find(item=>item.id===unitId)!;
  const unitRows=rows.filter(row=>row.unitId===unitId);
  const expected=ledgerInputs.filter(row=>row.unit_number===unit.unitNumber);
  const postedEntries=expected.map(row=>(input.ledgerEntries??[]).find(entry=>entry.request_id===row.request_id&&entry.unit_id===unitId&&entry.entry_type===row.entry_type&&entry.description===row.description&&entry.amount_pence===row.amount_pence&&entry.entry_date===row.entry_date&&(entry.due_date??"")===row.due_date&&present(entry.reference)));
  const posted=postedEntries.every(Boolean);
  const ledgerReferences=postedEntries.flatMap(entry=>entry?[entry.reference]:[]);
  const missing:string[]=[];
  if(!present(input.block.managementCompany))missing.push("Landlord / management company name");
  if(!present(input.block.name)||!present(input.block.address))missing.push("Property name and address");
  if(!present(settings?.landlordAddress))missing.push("Landlord address (Section 47; not assumed to be the agent address)");
  if(!present(settings?.agentAddress))missing.push("Managing agent address");
  if(!present(settings?.noticeAddress))missing.push("Address for service of notices (Section 48)");
  if(settings?.financialWordingReviewed!==true)missing.push("Manager review of landlord details and document wording");
  if(!posted)missing.push("Matching posted ledger entries and invoice / credit references for every schedule allocation");
  if(demand){
   if(!present(unit.paymentReference))missing.push("Unit bank payment reference");
   if(!present(settings?.bankName)||!present(settings?.accountName)||!/^\d{2}-?\d{2}-?\d{2}$/.test(settings?.sortCode??"")||!/^\d{8}$/.test(settings?.accountNumber??""))missing.push("Complete valid bank details");
   if(!present(settings?.paymentText)||settings?.paymentText===standardPaymentTerms)missing.push("Lease-consistent payment instructions reviewed against the exact due date (replace default 28-day wording)");
  }
  if(input.mode==="Issue"&&missing.length)throw new Error(`Unit ${unit.unitNumber}: formal ${demand?"demand":"credit note"} blocked. Missing: ${missing.join("; ")}.`);
  const kind=demand?"Demand" as const:"Credit note" as const;
  const status=input.mode==="Draft"?"Draft" as const:"Ready for issue" as const;
  const heading=`${status==="Draft"?"DRAFT — ":""}${demand?"Service charge demand":"Service charge credit note"}`;
  const source=posted?`Recorded ledger references: ${ledgerReferences.join(", ")}`:ledgerReferences.length?`Partially recorded: ${ledgerReferences.join(", ")}. This batch is not fully posted.`:"Prepared allocation only — no matching ledger posting has been established.";
  const allocationLines=unitRows.map(row=>`${row.scheduleName}: ${pounds(row.amountPence)}${row.chargePeriod?` | Charge period ${row.chargePeriod.start} to ${row.chargePeriod.end}`:" | Reason: surplus allocation under lease schedule"}`);
  const total=unitRows.reduce((sum,row)=>sum+row.amountPence,0);
  const paymentLines=demand?[`Payment due date: ${batch.input.dueDate}`,`Payment reference: ${unit.paymentReference||"NOT CONFIGURED"}`,`Bank: ${settings?.bankName||"NOT CONFIGURED"}`,`Account name: ${settings?.accountName||"NOT CONFIGURED"}`,`Sort code: ${settings?.sortCode||"NOT CONFIGURED"}`,`Account number: ${settings?.accountNumber||"NOT CONFIGURED"}`,"The exact due date above controls this document; preparation and issue dates are distinct."]: ["Reason for credit: surplus allocation under the listed lease schedule(s).", "This credit note does not assert that a cash refund has been made."];
  // Existing default wording claims posted charges and a blanket 28-day deadline; it is never copied into an unposted draft.
  const reviewedPaymentText=demand&&settings?.financialWordingReviewed===true&&present(settings.paymentText)&&settings.paymentText!==standardPaymentTerms?settings.paymentText:"";
  const lines=[heading,`To: Leaseholder(s), ${unit.unitNumber}`,`Property: ${input.block.name}`,input.block.address,`Landlord / management company: ${input.block.managementCompany||"NOT CONFIGURED"}`,`Landlord address: ${settings?.landlordAddress||"NOT CONFIGURED"}`,`Managing agent: AVIAF ASSET MANAGEMENT`,settings?.agentAddress||"Agent address: NOT CONFIGURED",`Address for service of notices (Section 48): ${settings?.noticeAddress||"NOT CONFIGURED"}`,`Preparation date: ${batch.input.preparedDate}`,`Planned issue date: ${batch.input.issueDate}`,`Batch: ${batch.input.batchId} | Saved revision: ${input.revision}`,source,"",...allocationLines,`Total ${demand?"demanded":"credit"}: ${pounds(total)}`,"",...paymentLines,...(reviewedPaymentText?["",reviewedPaymentText]:[]),...(status==="Draft"?["","DRAFT — NOT ISSUED. No email or notice has been sent.",...(missing.length?[`Formal issue requirements: ${missing.join("; ")}`]:[])]:["","Prepared for issue; generation alone does not establish sending or service."]),...(demand?["","Service Charges — Summary of tenants’ rights and obligations",...serviceChargeRights.map((right,index)=>`${index+1}. ${right}`)]:[])];
  const body=lines.join("\n");
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeDocumentHtml(heading)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:850px;margin:35px auto;padding:20px;color:#17202a}h1{font-size:25px}p{white-space:pre-wrap}section{margin-top:28px}ol li{margin-bottom:14px}@media print{body{margin:0;max-width:none}.rights{break-before:page}}</style></head><body><h1>${escapeDocumentHtml(heading)}</h1>${lines.slice(1,demand?lines.indexOf("Service Charges — Summary of tenants’ rights and obligations")-1:undefined).map(line=>`<p>${escapeDocumentHtml(line)}</p>`).join("")}${demand?`<section class="rights"><h2>Service Charges — Summary of tenants’ rights and obligations</h2><ol>${serviceChargeRights.map(right=>`<li>${escapeDocumentHtml(right)}</li>`).join("")}</ol></section>`:""}</body></html>`;
  const contentHash=await hash(JSON.stringify({body,html,blockId:input.block.id,unitId,batchId:batch.input.batchId,revision:input.revision,ledgerReferences}));
  const fileName=`${demand?"demand":"credit-note"}-${unitId}-${contentHash.slice(0,16)}.txt`;
  return Object.freeze({documentId:`financial-doc-${contentHash}`,contentHash,kind,status,blockId:input.block.id,unitId,batchId:batch.input.batchId,savedRevision:input.revision,posted,missingRequirements:Object.freeze(missing),ledgerReferences:Object.freeze(ledgerReferences),subject:`${heading} — ${unit.unitNumber}, ${input.block.name}`.replace(/[\r\n\u0000]/g," "),body,html,attachment:Object.freeze({fileName,mediaType:"text/plain" as const,encoding:"utf8" as const,content:body})});
 }));
 return Object.freeze(snapshots);
}
