import {buildPrivateAccountStatement} from "./private-account-statement-pdf.ts";
import type {AttachmentSnapshot} from "./management-delivery";
import {readReminderTemplate,renderReminderTemplate} from "./reminder-template.ts";
import type {Block,Unit} from "../app/types";
import type {ChargeEntry} from "./service-charges";
import {chargeSummary} from "./service-charges.ts";
import {buildBulkAccountStatements} from "./bulk-account-statements.ts";
import {contactRecipients,validateLeaseholderState,type ContactDraft} from "./leaseholder-planning.ts";
export type BulkReminderMode="overdue"|"outstanding";
export type BulkReminderAccount={unitId:number;unitNumber:string;reference:string|null;balance:number;due:number;overdue:number;upcoming:number;undated:number;dueDates:string[];recipients:string[];recipientNames:Record<string,string|null>;protectedRecipients:{email:string;status:string}[];eligible:boolean;reason:string};
export type BulkReminderSnapshot={blockId:number;blockName:string;asOf:string;generatedAt:string;mode:BulkReminderMode;fingerprint:string;contactRevision:number;ledgerRevision?:string;accounts:BulkReminderAccount[]};
// Deliberately NOT a First/Final reminder or a queue-compatible DeliveryEnvelope.
export type BulkReminderMessage={kind:"Overdue account reminder"|"Friendly balance notice";blockId:number;unitId:number;unitNumber:string;to:string;subject:string;body:string;attachments:AttachmentSnapshot[];statement:{blockId:number;unitId:number;asOf:string;sha256:string};statementText:string};
export type BulkReminderPreview={snapshot:BulkReminderSnapshot;messages:BulkReminderMessage[];previewToken:string;status:"Preview only — not queued or sent"};
export {bulkReminderDefaults} from "./reminder-template.ts";
// Authoritative ledger stays server-side; serialized/browser snapshots cannot generate statements.
const statementSources=new WeakMap<BulkReminderSnapshot,{block:Block;units:Unit[];entries:ChargeEntry[]}>();
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,"0")).join("");
const money=(n:number)=>`£${(n/100).toFixed(2)}`;
export async function buildBulkReminderSnapshot(input:{block:Block;units:Unit[];entries:ChargeEntry[];contactState:unknown;contactRevision:number;ledgerRevision?:string;protectedRecipients?:{unitId:number;recipient:string;status:string;idempotencyKey:string}[];asOf:string;generatedAt:string;mode:BulkReminderMode}):Promise<BulkReminderSnapshot>{
 if(!["overdue","outstanding"].includes(input.mode))throw Error("Choose overdue reminders or friendly outstanding balance notices.");
 if(!Number.isSafeInteger(input.contactRevision)||input.contactRevision<0)throw Error("Contact revision could not be verified.");
 const {block,units,entries,asOf,generatedAt,mode}=input;
 // Reuse strict complete-ledger validation, safe-pence checks and scoped account totals.
 const statements=buildBulkAccountStatements({block,units,entries,start:asOf,end:asOf,today:asOf,generatedAt,scope:"all"});
 const registry=validateLeaseholderState(input.contactState??{contacts:[],consultations:[]},block.id,units.map(u=>u.id),asOf);
 const grouped=new Map<number,ChargeEntry[]>();for(const row of entries){const rows=grouped.get(row.unit_id)??[];rows.push(row);grouped.set(row.unit_id,rows);}
 const contacts=new Map<number,ContactDraft[]>();for(const contact of registry.contacts){if(contact.unitId===null)continue;const rows=contacts.get(contact.unitId)??[];rows.push(contact);contacts.set(contact.unitId,rows);}
 const unitById=new Map(units.map(unit=>[unit.id,unit]));
 const protectedRows=input.protectedRecipients??[];
 if(!Array.isArray(protectedRows)||protectedRows.some(r=>!unitById.has(r.unitId)||typeof r.recipient!=="string"||!/^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(r.recipient)||!["Pending","Sending","Sent","Uncertain"].includes(r.status)||typeof r.idempotencyKey!=="string"))throw Error("Current private reminder status could not be verified.");
 const accounts=statements.accounts.map(account=>{
  const unit=unitById.get(account.unitId)!,rows=grouped.get(unit.id)??[],summary=chargeSummary(rows,asOf);
  const unpaid=rows.filter(e=>e.entry_type==="Charge"&&e.entry_date<=asOf&&(summary.remaining[e.id]??0)>0);
  const upcoming=unpaid.filter(e=>e.due_date&&e.due_date>asOf).reduce((n,e)=>n+summary.remaining[e.id],0),undated=unpaid.filter(e=>!e.due_date).reduce((n,e)=>n+summary.remaining[e.id],0);
  const confirmedRecipients=contactRecipients(contacts.get(unit.id)??[],block.id,"Demand").map(r=>r.email).sort();
  const recipientNames:Record<string,string|null>={};
  for(const email of confirmedRecipients){const names=[...new Set((contacts.get(unit.id)??[]).filter(c=>c.role==="Leaseholder"&&c.demands&&c.emails.includes(email)).map(c=>c.name.trim()))];recipientNames[email]=names.length===1&&names[0]&&!/[\r\n\0]/.test(names[0])?names[0]:null;}
  const protectedRecipients=protectedRows.filter(r=>r.unitId===unit.id&&confirmedRecipients.includes(r.recipient)).map(r=>({email:r.recipient,status:r.status}));
  const recipients=confirmedRecipients.filter(email=>!protectedRecipients.some(r=>r.email===email));
  const reasons:string[]=[];
  if(summary.balance<=0)reasons.push("Paid or in credit");
  else if(mode==="overdue"&&summary.overdue<=0)reasons.push("No recorded overdue amount");
  if(confirmedRecipients.length===0)reasons.push("No confirmed leaseholder email permitted for financial messages");
  else if(recipients.length===0)reasons.push("All eligible addresses already have a queued, accepted or uncertain reminder today; inspect history");
  const reason=reasons.join("; ")||"Eligible";
  return {unitId:unit.id,unitNumber:unit.unitNumber,reference:unit.paymentReference,balance:summary.balance,due:summary.due,overdue:summary.overdue,upcoming,undated,dueDates:[...new Set(unpaid.flatMap(e=>e.due_date?[e.due_date]:[]))].sort(),recipients,recipientNames,protectedRecipients,eligible:reason==="Eligible",reason};
 });
 const fingerprint=await hash({block:{id:block.id,name:block.name,address:block.address},asOf,mode,contactRevision:input.contactRevision,ledgerRevision:input.ledgerRevision,units:[...units].sort((a,b)=>a.id-b.id),entries:[...entries].sort((a,b)=>a.id-b.id),contacts:registry.contacts,protectedRecipients:protectedRows});
 const snapshot={blockId:block.id,blockName:block.name,asOf,generatedAt,mode,fingerprint,contactRevision:input.contactRevision,ledgerRevision:input.ledgerRevision,accounts};
 statementSources.set(snapshot,{block:structuredClone(block),units:structuredClone(units),entries:structuredClone(entries)});
 return snapshot;
}
export async function prepareBulkReminderPreview(snapshot:BulkReminderSnapshot,input:{unitIds:number[];subject:string;message:string;snapshotToken:string}):Promise<BulkReminderPreview>{
 if(input.snapshotToken!==snapshot.fingerprint)throw Error("Ledger or contacts changed. Refresh the accounts and review the selection again.");
 if(!Array.isArray(input.unitIds)||!input.unitIds.length||input.unitIds.length>1000||new Set(input.unitIds).size!==input.unitIds.length||input.unitIds.some(id=>!Number.isSafeInteger(id)))throw Error("Choose 1–1,000 distinct eligible unit accounts.");
 if(typeof input.subject!=="string"||!input.subject.trim()||input.subject.length>250||/[\r\n\0]/.test(input.subject))throw Error("Enter a subject of up to 250 characters without header controls.");
 if(typeof input.message!=="string"||!input.message.trim()||input.message.length>5000||input.message.includes('\0'))throw Error("Enter a message of up to 5,000 characters.");
 readReminderTemplate({subject:input.subject,message:input.message});
 const selected=input.unitIds.map(id=>{const a=snapshot.accounts.find(row=>row.unitId===id);if(!a?.eligible)throw Error("An account is no longer eligible. Refresh accounts before previewing.");return a;});
 const source=statementSources.get(snapshot);if(!source)throw Error("Refresh the authoritative ledger before generating private statements.");
 const documents=new Map<number,ReturnType<typeof buildPrivateAccountStatement>>();
 for(const account of selected){const unit=source.units.find(u=>u.id===account.unitId);if(!unit)throw Error("Statement unit scope could not be verified.");documents.set(account.unitId,buildPrivateAccountStatement({block:source.block,unit,entries:source.entries.filter(e=>e.unit_id===unit.id),asOf:snapshot.asOf}));}
 const messages:BulkReminderMessage[]=selected.flatMap(account=>account.recipients.map(to=>({kind:snapshot.mode==="overdue"?"Overdue account reminder":"Friendly balance notice",blockId:snapshot.blockId,unitId:account.unitId,unitNumber:account.unitNumber,to,attachments:[documents.get(account.unitId)!.attachment],statement:{blockId:snapshot.blockId,unitId:account.unitId,asOf:snapshot.asOf,sha256:documents.get(account.unitId)!.sha256},statementText:documents.get(account.unitId)!.text,subject:renderReminderTemplate(input.subject.trim(),{name:account.recipientNames?.[to]??null,unit:account.unitNumber,building:snapshot.blockName},true),body:[renderReminderTemplate(input.message.trim(),{name:account.recipientNames?.[to]??null,unit:account.unitNumber,building:snapshot.blockName}),`Building: ${snapshot.blockName}\nUnit: ${account.unitNumber}\nPayment reference: ${account.reference||"Not recorded"}\nAccount as at: ${snapshot.asOf}`,`Outstanding balance: ${money(account.balance)}\nDue as at ${snapshot.asOf} (including due today): ${money(account.due)}\nOverdue before ${snapshot.asOf}: ${money(account.overdue)}\nNot yet due: ${money(account.upcoming)}\nNo recorded due date: ${money(account.undated)}\nRecorded due dates for remaining charges: ${account.dueDates.join(", ")||"Not recorded"}`,"Recorded payments and credits have been applied to the oldest-due charges. This is an account reminder, not a new demand. No prior demand delivery is asserted. Amounts with future due dates are not overdue; missing due dates do not establish a payment deadline."].join("\n\n")})));
 if(messages.length>1000)throw Error("The batch exceeds 1,000 individual messages. Select fewer accounts.");
 if(new TextEncoder().encode(JSON.stringify({snapshot,messages})).byteLength>2_000_000)throw Error("The statement batch exceeds the safe preview size. Select fewer accounts.");
 return {snapshot,messages,previewToken:await hash({snapshotToken:snapshot.fingerprint,messages}),status:"Preview only — not queued or sent"};
}
