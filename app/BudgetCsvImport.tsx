"use client";
import {useMemo,useRef,useState} from "react";
import {budgetFileMessage,type BudgetFileStatus} from "../lib/budget-upload-status";
import type {RecipientBudgetSummary} from "../lib/recipient-budget";
import type {Unit} from "./types";
import {inspectBudgetCsv,inspectBudgetRows,buildBudgetPreview,parseUnitSharesCsv,reconcileShares} from "../lib/budget-import";
import {apportionLeaseBudget,validPlanningDate} from "../lib/financial-planning";
import {parseBudgetWorkbook,type BudgetWorkbook} from "../lib/budget-xlsx";
import {money} from "../lib/service-charges";
type ImportSchedule={id:string;name:string;amount:string;percentages:Record<number,string>};
export default function BudgetCsvImport({blockId,blockName,units,existingSchedules,onApply}:{blockId:number;blockName:string;units:Unit[];existingSchedules:ImportSchedule[];onApply:(schedule:ImportSchedule,startDate:string,recipientBudget?:RecipientBudgetSummary)=>void}){
 const [table,setTable]=useState<ReturnType<typeof inspectBudgetCsv>|null>(null),[column,setColumn]=useState(-1);
 const [workbook,setWorkbook]=useState<BudgetWorkbook|null>(null),[sheetIndex,setSheetIndex]=useState(-1);
 const [manualShares,setShares]=useState<ReturnType<typeof parseUnitSharesCsv>|null>(null),[manualMapping,setMapping]=useState<Record<string,string>|null>(null);
 const savedUnits=units.filter(unit=>unit.blockId===blockId);
 const shares=manualShares??savedUnits.filter(unit=>unit.serviceChargePercentage!=null).map(unit=>({code:String(unit.id),name:unit.unitNumber,percentage:unit.serviceChargePercentage!}));
 const mapping=manualMapping??Object.fromEntries(savedUnits.map(unit=>[String(unit.id),String(unit.id)]));
 const [error,setError]=useState(""),[confirmed,setConfirmed]=useState(""),[applied,setApplied]=useState(false),[busy,setBusy]=useState(false);
 const [summaryApproval,setSummaryApproval]=useState("");
 const [budgetFile,setBudgetFile]=useState<BudgetFileStatus|null>(null),[sharesFile,setSharesFile]=useState<BudgetFileStatus|null>(null);
 const [budgetStart,setBudgetStart]=useState("");
 const generation=useRef(0),fileLock=useRef(false);
 const preview=useMemo(()=>{try{return table&&column>=0?{data:buildBudgetPreview(table,column),error:""}:{data:null,error:""};}catch(e){return {data:null,error:(e as Error).message};}},[table,column]);
 const allocation=useMemo(()=>{try{
  if(!preview.data)return {data:null,error:""};
  if(!shares.length)throw new Error("No saved unit apportionments. Add them once in Units & residents, or upload a complete share file below.");
  const ids=shares.map(row=>Number(mapping[row.code]));
  if(ids.some(id=>!units.some(unit=>unit.id===id&&unit.blockId===blockId)))throw new Error("Map every CSV row to a unit in this building.");
  if(new Set(ids).size!==ids.length)throw new Error("Each unit can only be mapped once.");
  if(ids.length!==units.length)throw new Error("Supply one share for every unit in this building, including 0% for excluded units.");
  const result=reconcileShares(shares.map((row,i)=>({unitId:ids[i],percentage:row.percentage})));
  const amounts=apportionLeaseBudget(preview.data.totalPence,ids.map(unitId=>({unitId,percentage:result.percentages[unitId]})));
  return {data:{...result,amounts},error:""};
 }catch(e){return {data:null,error:(e as Error).message};}},[shares,mapping,units,blockId,preview]);
 const reviewKey=JSON.stringify([blockId,sheetIndex,table?.blockName,column,budgetStart,shares,mapping,preview.data,allocation.data]);
 const reviewed=confirmed===reviewKey;
 const summaryKey=JSON.stringify([blockId,sheetIndex,column,budgetStart,preview.data]);
 const summaryApproved=summaryApproval===summaryKey;
 async function load(file:File|undefined,kind:"budget"|"shares"){
  if(!file||fileLock.current)return;
  fileLock.current=true;setBusy(true);const setFileStatus=kind==="budget"?setBudgetFile:setSharesFile;setFileStatus({name:file.name,phase:"reading"});const version=++generation.current;setError("");setConfirmed("");setSummaryApproval("");setApplied(false);
  if(kind==="budget"){setWorkbook(null);setSheetIndex(-1);setTable(null);setColumn(-1);setBudgetStart("");}else{setShares([]);setMapping({});}
  try{
   if(kind==="budget"&&/\.xlsx$/i.test(file.name)){
    if(file.size>2*1024*1024)throw new Error("XLSX files must be no larger than 2 MB.");
    const result=await parseBudgetWorkbook(await file.arrayBuffer());if(version!==generation.current)return;setWorkbook(result);setFileStatus({name:file.name,phase:"ready"});return;
   }
   if(!/\.csv$/i.test(file.name))throw new Error(kind==="budget"?"Choose a .xlsx workbook or .csv budget file.":"Unit shares must be a CSV file.");
   if(file.size>2*1024*1024)throw new Error("CSV files must be no larger than 2 MB.");
   const text=await file.text();if(version!==generation.current)return;
   if(kind==="budget")setTable(inspectBudgetCsv(text));
   else {const rows=parseUnitSharesCsv(text);setShares(rows);setMapping(Object.fromEntries(rows.map(row=>{const matches=units.filter(unit=>unit.blockId===blockId&&(unit.unitNumber===row.code||unit.unitNumber===row.name));return [row.code,matches.length===1?String(matches[0].id):""];})));}
   setFileStatus({name:file.name,phase:"ready"});
  }catch(e){if(version===generation.current)setFileStatus({name:file.name,phase:"error",error:(e as Error).message});}finally{if(version===generation.current){fileLock.current=false;setBusy(false);}}
 }
 function reset(){generation.current++;fileLock.current=false;setBusy(false);setBudgetFile(null);setSharesFile(null);setWorkbook(null);setSheetIndex(-1);setTable(null);setColumn(-1);setBudgetStart("");setShares(null);setMapping(null);setError("");setConfirmed("");setSummaryApproval("");setApplied(false);}
 return <section className="panel tenant-card tenant-form" aria-label="Budget CSV import" aria-busy={busy}>
  <h3>Import budget for {blockName}</h3><p>Each building uses its own file, year and unit shares. Choose an Excel (.xlsx) workbook or a budget worksheet exported as CSV. Select the annual budget column explicitly; prior-year figures, invoices and paid totals are not additional budgets. Files are read locally in your browser. Imports remain unsaved until you save the budget below. The original file is not stored or attached to service charge demands.</p>
  <p>{manualShares===null?`Saved unit apportionments loaded: ${shares.length} of ${savedUnits.length} units. Complete shares are reused automatically. Missing or invalid totals block allocation; update Units & residents first.`:"Using alternative shares for this preview only. Saved unit apportionments are unchanged."}</p>
  {budgetFile&&<p role={budgetFile.phase==="error"?"alert":"status"} aria-live="polite">{budgetFileMessage(budgetFile,applied?"The reviewed budget has been applied to the preparation. Save it explicitly to retain it.":workbook&&sheetIndex<0?"Next: choose the budget worksheet below.":!table?"Choose a worksheet containing the budget category table.":column<0?"Next: choose the annual budget column below.":!budgetStart?"Next: confirm the start date for this budget year.":"Next: review the budget and unit shares, then choose Use reviewed annual budget. This file is not yet saved.")}</p>}
  <fieldset disabled={busy} style={{border:0,padding:0}}>
  <div onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(event.dataTransfer.files.length!==1){setError("Drop one budget file at a time.");return;}void load(event.dataTransfer.files[0],"budget");}} style={{border:"2px dashed #9d8750",padding:20}}>
   <label>Drop budget Excel or CSV here or choose a file<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event=>{void load(event.target.files?.[0],"budget");event.target.value="";}}/></label>
  </div>
  {workbook&&<><label>Budget worksheet<select value={sheetIndex} onChange={event=>{
   const index=Number(event.target.value);setSheetIndex(index);setTable(null);setColumn(-1);setBudgetStart("");setConfirmed("");setSummaryApproval("");setApplied(false);setError("");
   if(index>=0)try{setTable(inspectBudgetRows(workbook.sheets[index].rows));}catch(e){setError((e as Error).message);}
  }}><option value={-1}>Select Summary or the budget worksheet</option>{workbook.sheets.map((sheet,index)=><option key={index} value={index}>{sheet.name}</option>)}</select></label>
  <p>Only the selected worksheet and annual amount column are used. {workbook.cachedFormulaCount>0?"Formula results are cached values saved by Excel, not recalculated here. Recalculate and save in Excel first if figures may be stale.":""} Other sheets are not additional budgets. This preview does not approve the entire workbook for sharing.</p></>}
  {table&&<><p>File building: <strong>{table.blockName||"Not specified"}</strong>. Period: {table.startDate||"Not specified"} to {table.endDate||"Not specified"}. Verify these against <strong>{blockName}</strong>.</p>
  <label>Annual budget column<select value={column} onChange={event=>{setColumn(Number(event.target.value));setBudgetStart("");setSummaryApproval("");setConfirmed("");setApplied(false);}}><option value={-1}>Select the correct budget year</option>{table.headers.map((header,index)=><option key={index} value={index}>{header||`Column ${index+1}`}</option>)}</select></label></>}
  {table&&<label>Confirmed start date for the selected budget year<input type="date" value={budgetStart} onChange={event=>{setBudgetStart(event.target.value);setSummaryApproval("");setConfirmed("");setApplied(false);}}/></label>}
  {preview.error&&<p role="alert">{preview.error}</p>}
  {preview.data&&<><table><caption>Budget categories to include</caption><thead><tr><th>Category</th><th>Annual budget</th></tr></thead><tbody>{preview.data.categories.map(row=><tr key={row.name}><td>{row.name}</td><td>{money(row.amountPence)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><td>{money(preview.data.totalPence)}</td></tr></tfoot></table>
  <label>Use this building’s existing shares<select value="" onChange={event=>{const schedule=existingSchedules.find(item=>item.id===event.target.value);if(!schedule)return;setShares(units.map(unit=>({code:String(unit.id),name:unit.unitNumber,percentage:schedule.percentages[unit.id]??""})));setMapping(Object.fromEntries(units.map(unit=>[String(unit.id),String(unit.id)])));setConfirmed("");setApplied(false);}}><option value="">Optional: override with a current schedule</option>{existingSchedules.filter(schedule=>units.length>0&&units.every(unit=>typeof schedule.percentages[unit.id]==="string"&&schedule.percentages[unit.id]!=="")).map(schedule=><option key={schedule.id} value={schedule.id}>{schedule.name||"Unnamed schedule"}</option>)}</select></label><label>Alternative building unit shares CSV (optional)<input type="file" accept=".csv,text/csv" onChange={event=>{void load(event.target.files?.[0],"shares");event.target.value="";}}/></label>{sharesFile&&<p role={sharesFile.phase==="error"?"alert":"status"}>{budgetFileMessage(sharesFile,"Review every unit mapping and share below. These shares are for this preview only.")}</p>}<p>Columns: Unit Code, Unit Name, Service Charge (Percentage). External ID values never identify portal records. Check each mapping below.</p></>}
  {shares.length>0&&<table><caption>Verify this building’s unit mapping</caption><thead><tr><th>CSV unit</th><th>Portal unit</th><th>Source share</th></tr></thead><tbody>{shares.map(row=><tr key={row.code}><td>{row.code} · {row.name}</td><td><select aria-label={`Portal unit for ${row.code}`} value={mapping[row.code]??""} onChange={event=>{setMapping({...mapping,[row.code]:event.target.value});setConfirmed("");setApplied(false);}}><option value="">Select unit</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.unitNumber}</option>)}</select></td><td>{row.percentage}%</td></tr>)}</tbody></table>}
  {allocation.error&&<p role="alert">{allocation.error}</p>}
  {allocation.data&&<><p>Source percentages total {allocation.data.sourceTotal}%. {allocation.data.adjusted?"Small rounding differences are accepted. The effective shares below have been adjusted to exactly 100%; review them before applying. The annual budget total is unchanged.":"Percentages total exactly 100%."}</p><table><caption>Annual allocation preview</caption><thead><tr><th>Unit</th><th>Effective share</th><th>Annual amount</th></tr></thead><tbody>{allocation.data.amounts.map(row=><tr key={row.unitId}><td>{units.find(unit=>unit.id===row.unitId)?.unitNumber}</td><td>{allocation.data!.percentages[row.unitId]}%</td><td>{money(row.amountPence)}</td></tr>)}</tbody></table>
  <label><input type="checkbox" checked={summaryApproved} onChange={event=>setSummaryApproval(event.target.checked?summaryKey:"")}/> I approve the category names, annual amounts and total shown above for a resident-facing budget summary PDF. No notes, other worksheets, unit shares or original workbook will be included.</label>
  <p>This optional approval retains the summary with the saved budget. Initial-demand delivery requires a matching summary and a separate review of the actual attachment before sending.</p>
  <label><input type="checkbox" checked={reviewed} onChange={event=>setConfirmed(event.target.checked?reviewKey:"")}/> I have checked the building, budget year, total, unit mappings and effective shares against the leases.</label>
  <button type="button" className="primary" disabled={!reviewed||applied||!preview.data||!validPlanningDate(budgetStart)} onClick={()=>{if(!reviewed||applied||!allocation.data||!preview.data||!table||!validPlanningDate(budgetStart))return;try{onApply({id:`import-budget:${blockId}:${budgetStart}`,name:`${table.headers[column]} — ${blockName}`.slice(0,200),amount:(preview.data.totalPence/100).toFixed(2),percentages:allocation.data.percentages},budgetStart,summaryApproved?{blockId,yearStart:budgetStart,scheduleId:`import-budget:${blockId}:${budgetStart}`,categories:preview.data.categories,totalPence:preview.data.totalPence}:undefined);setApplied(true);}catch(e){setError((e as Error).message);}}}>Use reviewed annual budget</button>
  {applied&&<p role="status">Added to the preparation below. Prior posted charges are unchanged. Save explicitly to retain this budget. No resident account has been charged.</p>}</>}
  {error&&<p role="alert">{error}</p>}<button type="button" className="unit-secondary" onClick={reset}>Clear import preview</button>
  </fieldset>
 </section>;
}
