import {createHash} from "node:crypto";
import type {AttachmentSnapshot} from "./management-delivery.ts";
import {chargeSummary,type ChargeEntry} from "./service-charges.ts";

export type PrivateAccountStatementInput={
 block:{id:number;name:string};
 unit:{id:number;blockId:number;unitNumber:string;paymentReference:string|null};
 /** Complete ledger for exactly this unit, including history before any reporting period. */
 entries:ChargeEntry[];
 asOf:string;
};
const extra:Record<string,string>={"€":"\x80","‚":"\x82","ƒ":"\x83","„":"\x84","…":"\x85","†":"\x86","‡":"\x87","ˆ":"\x88","‰":"\x89","Š":"\x8a","‹":"\x8b","Œ":"\x8c","Ž":"\x8e","‘":"\x91","’":"\x92","“":"\x93","”":"\x94","•":"\x95","–":"\x96","—":"\x97","˜":"\x98","™":"\x99","š":"\x9a","›":"\x9b","œ":"\x9c","ž":"\x9e","Ÿ":"\x9f"};
function encode(value:string){return Array.from(value,c=>{
 if(extra[c])return extra[c];
 const code=c.codePointAt(0)!;
 if(code>=32&&code<=126||code>=160&&code<=255)return c;
 throw Error("Statement contains unsupported characters. Review labels before delivery; no PDF has been prepared.");
}).join("");}
function label(value:unknown,required=false){
 if(typeof value!=="string"||value.length>2000||required&&!value.trim())throw Error("Invalid statement label.");
 encode(value);return value;
}
function date(value:string){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)!==value)throw Error("Use valid statement dates.");}
function id(value:number){if(!Number.isSafeInteger(value)||value<=0)throw Error("Invalid statement scope or ledger identifier.");}
function sum(values:number[]){let result=0;for(const n of values){result+=n;if(!Number.isSafeInteger(result))throw Error("Statement exceeds supported accounting precision.");}return result;}
const money=(n:number)=>`${n<0?"-":""}£${(Math.abs(n)/100).toFixed(2)}`;
function wrap(value:string){const lines:string[]=[];while(value.length>68){let cut=value.lastIndexOf(" ",68);if(cut<1)cut=68;lines.push(value.slice(0,cut));value=value.slice(cut).replace(/^ /,"");}lines.push(value);return lines;}
/** Minimal inert PDF with deterministic object order, byte lengths and cross references. */
function pdf(lines:string[],heading:string){
 const wrapped=lines.flatMap(wrap),pages:string[][]=[];
 for(let i=0;i<wrapped.length;i+=43)pages.push(wrapped.slice(i,i+43));
 const objects=["<< /Type /Catalog /Pages 2 0 R >>",`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(" ")}] /Count ${pages.length} >>`,"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"];
 const literal=(s:string)=>encode(s).replace(/[\\()]/g,"\\$&");
 pages.forEach((page,index)=>{
  const content=[`BT /F1 10 Tf 1 0 0 1 48 802 Tm (${literal(heading)}) Tj`,...page.map((line,i)=>`1 0 0 1 48 ${774-i*16} Tm (${literal(line)}) Tj`),`1 0 0 1 48 48 Tm (Page ${index+1} of ${pages.length}) Tj ET`].join("\n");
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`,`<< /Length ${Buffer.byteLength(content,"latin1")} >>\nstream\n${content}\nendstream`);
 });
 let out="%PDF-1.4\n";const offsets=[0];
 objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(out,"latin1"));out+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
 const xref=Buffer.byteLength(out,"latin1");
 out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(out,"latin1");
}
/** New immutable per-unit snapshot only; never mutates earlier statements or ledger rows. */
export function buildPrivateAccountStatement(input:PrivateAccountStatementInput){
 const {block,unit,entries,asOf}=input;
 id(block.id);id(unit.id);date(asOf);
 if(unit.blockId!==block.id||!Array.isArray(entries))throw Error("Statement scope could not be verified.");
 label(block.name,true);label(unit.unitNumber,true);if(unit.paymentReference!==null)label(unit.paymentReference);
 const seen=new Set<number>();
 for(const e of entries){
  id(e.id);if(e.block_id!==block.id||e.unit_id!==unit.id)throw Error("Statement ledger must contain only the selected building and unit.");
  if(seen.has(e.id))throw Error("Duplicate statement ledger identifier.");seen.add(e.id);
  date(e.entry_date);if(e.due_date!==null)date(e.due_date);
  if(!["Charge","Payment","Credit"].includes(e.entry_type)||!Number.isSafeInteger(e.amount_pence)||e.amount_pence<=0)throw Error("Invalid statement ledger amount or type.");
  label(e.description);label(e.reference);
 }
 const rows=entries.filter(e=>e.entry_date<=asOf).sort((a,b)=>a.entry_date<b.entry_date?-1:a.entry_date>b.entry_date?1:a.id-b.id);
 sum(rows.filter(e=>e.entry_type==="Charge").map(e=>e.amount_pence));sum(rows.filter(e=>e.entry_type!=="Charge").map(e=>e.amount_pence));
 const summary=chargeSummary(rows,asOf);
 const lines=["ACCOUNT STATEMENT",block.name,`Unit: ${unit.unitNumber}`,`Building ID: ${block.id} | Unit ID: ${unit.id}`,`Account / payment reference: ${unit.paymentReference||"Not recorded"}`,`As at: ${asOf}`,"Full recorded ledger history through the statement date.","Opening balance (before recorded history): £0.00",""];
 let balance=0;
 for(const row of rows){const debit=row.entry_type==="Charge"?row.amount_pence:0,credit=row.entry_type==="Charge"?0:row.amount_pence;balance=sum([balance,debit,-credit]);lines.push(`${row.entry_date} | Entry ${row.id} | ${row.entry_type}`,`Description: ${row.description||"Not recorded"}`,`Reference: ${row.reference||"Not recorded"}`,`Recorded due date: ${row.due_date||"Not recorded"}`,`Debit: ${money(debit)} | Credit: ${money(credit)}`,`Running balance: ${money(balance)}`,"");}
 if(!rows.length)lines.push("No recorded movements through this date.","");
 lines.push(`Closing account balance: ${money(summary.balance)}`,`Due as at ${asOf} (includes due today): ${money(summary.due)}`,`Overdue (due before ${asOf}): ${money(summary.overdue)}`,`Not yet due / no due date: ${money(Math.max(0,summary.balance)-summary.due)}`,summary.balance<0?`Account in credit: ${money(-summary.balance)}`:"", "Account statement only, not a payment demand.","Payments and credits are applied oldest-due-first.","Entries after the statement date are excluded.","Missing due dates do not establish a payment deadline.","No new fees, deadlines or legal action are added.");
 const text=lines.join("\n"),content=pdf(lines,`Account statement | Building ${block.id} | Unit ${unit.id} | ${asOf}`),sha256=createHash("sha256").update(content).digest("hex");
 const attachment:Readonly<AttachmentSnapshot>=Object.freeze({fileName:`statement-${block.id}-${unit.id}-${asOf}-${sha256.slice(0,12)}.pdf`,mediaType:"application/pdf",encoding:"base64",content:content.toString("base64")});
 return {attachment,text,summary,sha256};
}
