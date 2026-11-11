import type {Block,Unit} from "../app/types";
import {chargeSummary,type ChargeEntry} from "./service-charges.ts";
import {statementPaymentMessage} from "./service-charge-document.ts";
export type AccountScope="debt"|"all";
export type BulkStatementInput={block:Block;units:Unit[];entries:ChargeEntry[];start:string;end:string;today:string;scope:AccountScope;generatedAt:string;synthetic?:boolean};
export type BulkStatements={html:string;blockId:number;start:string;end:string;scope:AccountScope;generatedAt:string;accounts:{unitId:number;unitNumber:string;opening:number;balance:number;due:number;overdue:number}[]};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const money=(n:number)=>`£${(n/100).toFixed(2)}`;
function date(s:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(`${s}T12:00:00Z`).toISOString().slice(0,10)!==s)throw Error("Enter valid statement dates.");}
function sum(ns:number[]){let total=0;for(const n of ns){total+=n;if(!Number.isSafeInteger(total))throw Error("Account exceeds supported accounting precision.");}return total;}
/** Strict scoped inputs: never silently discard unknown accounts from a supposedly complete export. */
export function buildBulkAccountStatements(input:BulkStatementInput):BulkStatements{
 const {block,units,entries,start,end,today,scope,generatedAt}=input;
 for(const d of [start,end,today])date(d);
 if(start>end||end>today)throw Error("Choose a period ending no later than today, with start on or before end.");
 if(!Number.isSafeInteger(block.id)||block.id<=0||!["debt","all"].includes(scope))throw Error("Choose a building and account scope.");
 if(typeof generatedAt!=="string"||!Number.isFinite(Date.parse(generatedAt)))throw Error("Snapshot time could not be verified.");
 if(!Array.isArray(units)||!Array.isArray(entries))throw Error("Complete units and ledger records are required.");
 if(units.some(u=>u.blockId!==block.id||!Number.isSafeInteger(u.id)||u.id<=0||typeof u.unitNumber!=="string"||(u.paymentReference!==null&&typeof u.paymentReference!=="string"))||new Set(units.map(u=>u.id)).size!==units.length)throw Error("Unit scope could not be verified for this building.");
 const ids=new Set(units.map(u=>u.id));
 if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error("Duplicate ledger rows prevent a reliable statement.");
 for(const e of entries){
  if(e.block_id!==block.id||!ids.has(e.unit_id))throw Error("Ledger scope could not be verified for this building.");
  date(e.entry_date);if(e.due_date!==null)date(e.due_date);
  if(!Number.isSafeInteger(e.id)||e.id<=0||!Number.isSafeInteger(e.amount_pence)||e.amount_pence<=0||!["Charge","Payment","Credit"].includes(e.entry_type)||typeof e.reference!=="string"||typeof e.description!=="string")throw Error("Invalid ledger record. Refresh and review the account.");
 }
 const byUnit=new Map<number,ChargeEntry[]>();
 for(const entry of entries){if(entry.entry_date>end)continue;const account=byUnit.get(entry.unit_id)??[];account.push(entry);byUnit.set(entry.unit_id,account);}
 const accounts:BulkStatements["accounts"]=[],pages:string[]=[];
 for(const unit of [...units].sort((a,b)=>a.unitNumber.localeCompare(b.unitNumber,undefined,{numeric:true})||a.id-b.id)){
  const rows=(byUnit.get(unit.id)??[]).sort((a,b)=>a.entry_date.localeCompare(b.entry_date)||a.id-b.id);
  // Check both debit and settlement sums before the existing allocation helper performs arithmetic.
  sum(rows.filter(e=>e.entry_type==="Charge").map(e=>e.amount_pence));sum(rows.filter(e=>e.entry_type!=="Charge").map(e=>e.amount_pence));
  const summary=chargeSummary(rows,end);if(scope==="debt"&&summary.balance<=0)continue;
  const opening=sum(rows.filter(e=>e.entry_date<start).map(e=>e.entry_type==="Charge"?e.amount_pence:-e.amount_pence));let balance=opening;
  const movements=rows.filter(e=>e.entry_date>=start).map(e=>{const debit=e.entry_type==="Charge"?e.amount_pence:0,credit=e.entry_type==="Charge"?0:e.amount_pence;balance=sum([balance,debit,-credit]);return `<tr><td>${escape(e.entry_date)}</td><td>${escape(e.entry_type)} · ${escape(e.description)}<br>Reference: ${escape(e.reference||"Not recorded")}<br>Recorded due date: ${escape(e.entry_type==="Charge"?(e.due_date||"Not recorded"):"Not applicable")}</td><td>${debit?money(debit):""}</td><td>${credit?money(credit):""}</td><td>${money(balance)}</td></tr>`;});
  accounts.push({unitId:unit.id,unitNumber:unit.unitNumber,opening,balance:summary.balance,due:summary.due,overdue:summary.overdue});
  pages.push(`<article class="account"><p class="warning">MANAGER-ONLY COMBINED FILE · Do not send this file to an individual resident.${input.synthetic?" SYNTHETIC REVIEW DATA.":""}</p><h1>Account statement</h1><h2>Unit ${escape(unit.unitNumber)} · ${escape(block.name)}</h2><p>${escape(block.address)}<br>Building ID: ${block.id} · Unit ID: ${unit.id}<br>Payment reference / account code: ${escape(unit.paymentReference||"Not recorded")}</p><p>Statement period: ${start} to ${end}<br>Ledger retrieved: ${escape(generatedAt)}</p><table><thead><tr><th>Date</th><th>Entry</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody><tr><td>Before ${start}</td><td>Opening balance</td><td></td><td></td><td>${money(opening)}</td></tr>${movements.join("")}${!movements.length?'<tr><td colspan="5">No movements in this period.</td></tr>':""}</tbody></table><p><strong>${summary.balance<0?"Account in credit":"Closing account balance"}: ${money(Math.abs(summary.balance))}</strong><br>Due as at ${end} (includes due today): ${money(summary.due)}<br>Overdue (before ${end}): ${money(summary.overdue)}<br>Outstanding not yet due or with no recorded due date: ${money(Math.max(0,summary.balance)-summary.due)}</p><p>${escape(summary.balance>0&&summary.due>0?"This statement shows the recorded account balance and amounts due as at the statement end. It is not a payment demand.":statementPaymentMessage(summary.balance,summary.due,false,""))}</p><p>Account statement only, not a payment demand. Payments and credits are applied oldest-due-first. Entries dated after the statement end are excluded. Missing due dates do not establish a payment deadline. No new fees, deadlines or legal action are added.</p><p>No recipient or ownership is inferred from resident records. Verify account, leaseholder and current payments separately before issuing any individual document.</p></article>`);
 }
 return {blockId:block.id,start,end,scope,generatedAt,accounts,html:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Manager-only account statements</title><style>@page{size:A4;margin:16mm}body{font:12px Arial,sans-serif;color:#111;max-width:900px;margin:24px auto;padding:16px}h1{font-size:24px}h2{font-size:18px}.warning{border:2px solid #92520a;padding:10px;font-weight:bold}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top;overflow-wrap:anywhere}th:nth-child(n+3),td:nth-child(n+3){text-align:right;white-space:nowrap}thead{display:table-header-group}tr{break-inside:avoid}.account+.account{break-before:page;page-break-before:always}@media print{body{margin:0;padding:0;max-width:none}}</style></head><body>${pages.join("")||"<p>No accounts match this scope.</p>"}</body></html>`};
}
