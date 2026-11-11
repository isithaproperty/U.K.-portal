import {createHash} from "node:crypto";
import {planningPeriods,type FinancialPlanningState} from "./financial-planning.ts";
import {validateRecipientBudgets} from "./recipient-budget.ts";
/** Deterministic PDF, plain text only. No scripts, URLs, embedded workbook or account details. */
function pdf(lines:string[]):Buffer {
 lines=lines.flatMap(wrap);
 const chunks:string[][]=[];for(let i=0;i<lines.length;i+=43)chunks.push(lines.slice(i,i+43));
 const objects:string[]=["<< /Type /Catalog /Pages 2 0 R >>",`<< /Type /Pages /Kids [${chunks.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${chunks.length} >>`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
 chunks.forEach((page,index)=>{
  const text=page.map((line,i)=>`1 0 0 1 48 ${790-i*17} Tm (${encodeText(line).replace(/[\\()]/g,'\\$&')}) Tj`).join('\n');
  const stream=`BT /F1 11 Tf\n${text}\nET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);
 });
 let output='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output,'latin1'));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(output,'latin1');output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(output,'latin1');
}
function encodeText(text:string){
 const extra:Record<string,string>={"–":"\x96","—":"\x97","’":"\x92","‘":"\x91","“":"\x93","”":"\x94","€":"\x80"};
 const encoded=Array.from(text,c=>extra[c]??c).join("");
 if(/[^\x20-\xff]/.test(encoded))throw Error("Budget PDF contains unsupported characters. Review the budget labels before delivery.");
 return encoded;
}
function wrap(text:string){const result:string[]=[];while(text.length>45){let cut=text.lastIndexOf(' ',45);if(cut<1)cut=45;result.push(text.slice(0,cut));text=text.slice(cut).replace(/^ /,'');}result.push(text);return result;}
export function initialDemandBudget(state:FinancialPlanningState,block:{id:number;name:string},revision:number){
 if(state.kind!=="Demand")return null;
 if(typeof state.initialDemand!=="boolean")throw Error("Save whether this is the first service-charge demand for the selected building and budget year.");
 if(!state.initialDemand)return null;
 if(state.blockId!==block.id||!Number.isSafeInteger(revision)||revision<1||!state.prepared)throw Error("Save the exact building budget before preparing its attachment.");
 const summaries=validateRecipientBudgets(state.recipientBudgets??[],block.id,state.yearStart,state.schedules);
 if(summaries.length!==state.schedules.length)throw Error("The first service-charge demand requires a reviewed recipient budget summary for every schedule. Import and save the budget first.");
 const yearEnd=planningPeriods(state.yearStart,"Annual")[0].end;
 const lines=['SERVICE CHARGE ANNUAL BUDGET',...wrap(block.name),`Budget year: ${state.yearStart} to ${yearEnd}`,`Building ${block.id} | Saved budget revision ${revision}`,'Recipient-safe summary of selected budget categories.','Original workbook and invoice/payment sheets are not included.',''];
 for(const schedule of state.schedules){const summary=summaries.find(s=>s.scheduleId===schedule.id)!;lines.push(...wrap(schedule.name));for(const row of summary.categories)lines.push(...wrap(`${row.name}: £${(row.amountPence/100).toFixed(2)}`));lines.push(`Annual schedule total: £${(summary.totalPence/100).toFixed(2)}`,'');}
 lines.push('Please read with your individual service-charge demand.');
 const content=pdf(lines),sha256=createHash('sha256').update(content).digest('hex');
 return {attachment:Object.freeze({fileName:`budget-${block.id}-${state.yearStart}-${sha256.slice(0,12)}.pdf`,mediaType:'application/pdf' as const,encoding:'base64' as const,content:content.toString('base64')}),evidence:{kind:'Initial demand budget summary',blockId:block.id,yearStart:state.yearStart,yearEnd,savedRevision:revision,sha256,format:'Generated recipient-safe PDF',categories:summaries}};
}
