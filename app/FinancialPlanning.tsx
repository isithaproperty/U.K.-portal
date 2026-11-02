"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {Block,Unit,Resident} from "./types";
import {generateFinancialDocuments,type FinancialDocumentSnapshot} from "../lib/management-documents";
import {money,type ChargeEntry} from "../lib/service-charges";
import {parsePounds,planningPeriods,prepareFinancialDraft,type DemandFrequency,validateFinancialState,type FinancialDraftInput,type FinancialDraftRow,type FinancialPlanningState} from "../lib/financial-planning";

type ScheduleForm={id:string;name:string;amount:string;percentages:Record<number,string>};
type Prepared={input:FinancialDraftInput;rows:FinancialDraftRow[]};
export default function FinancialPlanning({blocks,units,today,reviewOnly=false,canPost=false}:{blocks:Block[];units:Unit[];residents?:Resident[];entries?:ChargeEntry[];today:string;reviewOnly?:boolean;canPost?:boolean}){
 const [blockId,setBlockId]=useState(blocks[0]?.id??0);
 const [kind,setKind]=useState<"Demand"|"Surplus credit">("Demand");
 const [schedules,setSchedules]=useState<ScheduleForm[]>([{id:"schedule-1",name:"",amount:"",percentages:{}}]);
 const [frequency,setFrequency]=useState<DemandFrequency>("Annual");
 const [yearStart,setYearStart]=useState(today);
 const [periodIndex,setPeriodIndex]=useState(0);
 const [issueMode,setIssueMode]=useState<FinancialDraftInput["issueMode"]>("Issue now, future due date");
 const [issueDate,setIssueDate]=useState(today),[dueDate,setDueDate]=useState(today);
 const [leaseConfirmed,setLeaseConfirmed]=useState(false);
 const [prepared,setPrepared]=useState<Prepared|null>(null),[error,setError]=useState("");
 const [revision,setRevision]=useState(0),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[persistenceReady,setPersistenceReady]=useState(false),[conflict,setConflict]=useState(false),[storageStatus,setStorageStatus]=useState(""),[reload,setReload]=useState(0);
 const saveLock=useRef(false);
 const postLock=useRef(false);
 const documentGeneration=useRef(0);
 const [documents,setDocuments]=useState<readonly Readonly<FinancialDocumentSnapshot>[]>([]),[documentUnit,setDocumentUnit]=useState<number|null>(null),[generatingDocuments,setGeneratingDocuments]=useState(false);
 const [posting,setPosting]=useState(false),[savedBatchId,setSavedBatchId]=useState<string|null>(null),[postedBatchId,setPostedBatchId]=useState<string|null>(null);
 const selectedUnits=useMemo(()=>units.filter(unit=>unit.blockId===blockId),[units,blockId]);
 const periods=useMemo(()=>{try{return planningPeriods(yearStart,frequency);}catch{return [];}},[yearStart,frequency]);
 function applyState(state:FinancialPlanningState){setKind(state.kind);setSchedules(state.schedules);setFrequency(state.frequency);setYearStart(state.yearStart);setPeriodIndex(state.periodIndex);setIssueMode(state.issueMode);setIssueDate(state.issueDate);setDueDate(state.dueDate);setPrepared(state.prepared);setLeaseConfirmed(false);}
 useEffect(()=>{
  const controller=new AbortController();
  documentGeneration.current++;setGeneratingDocuments(false);
  setDocuments([]);setDocumentUnit(null);setPersistenceReady(false);setRevision(0);setConflict(false);setSavedBatchId(null);setPostedBatchId(null);setError("");setLeaseConfirmed(false);setPrepared(null);
  setKind("Demand");setSchedules([{id:"schedule-1",name:"",amount:"",percentages:{}}]);setFrequency("Annual");setYearStart(today);setPeriodIndex(0);setIssueMode("Issue now, future due date");setIssueDate(today);setDueDate(today);
  if(reviewOnly||!blockId){setLoading(false);setStorageStatus(reviewOnly?"Preview only: saving is disabled.":"");return ()=>controller.abort();}
  setLoading(true);setStorageStatus("Loading saved financial preparation…");
  void(async()=>{try{
   const response=await fetch(`/api/blocks/${blockId}/management-review/financials`,{signal:controller.signal,cache:"no-store"});const result=await response.json();
   if(!response.ok)throw new Error(result.error||"Saved financial preparation could not be loaded.");
   if(!Number.isInteger(result.revision)||result.revision<0||!("state" in result))throw new Error("The server returned invalid saved preparation.");
   const state=result.state===null?null:validateFinancialState(result.state,blockId,selectedUnits.map(unit=>unit.id),today);
   if(controller.signal.aborted)return;
   if(state)applyState(state);
   setSavedBatchId(state?.prepared?.input.batchId??null);
   setRevision(result.revision);setPersistenceReady(true);setStorageStatus(state?`Loaded saved preparation (revision ${result.revision}).`:"No saved preparation for this block. Save explicitly to keep your budget.");
  }catch(cause){if(!controller.signal.aborted)setStorageStatus(cause instanceof Error?cause.message:"Could not load saved preparation.");}
  finally{if(!controller.signal.aborted)setLoading(false);}})();
  return ()=>controller.abort();
 },[blockId,reviewOnly,reload,selectedUnits,today]);
 async function savePreparation(){
  if(reviewOnly||!persistenceReady||conflict||saveLock.current||postLock.current)return;
  saveLock.current=true;setSaving(true);setStorageStatus("");
  try{
   const state=validateFinancialState({version:1,blockId,kind,schedules,frequency,yearStart,periodIndex,issueMode,issueDate,dueDate,prepared},blockId,selectedUnits.map(unit=>unit.id),today);
   const response=await fetch(`/api/blocks/${blockId}/management-review/financials`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state,revision})});const result=await response.json();
   if(response.status===409){setConflict(true);throw new Error("Another manager has saved changes. Export your prepared batch if needed, then reload the saved version before saving again.");}
   if(!response.ok)throw new Error(result.error||"Financial preparation was not saved.");
   if(!Number.isInteger(result.revision)||result.revision<=revision)throw new Error("Save outcome could not be verified. Reload the saved version before trying again.");
   setDocuments([]);setRevision(result.revision);setSavedBatchId(prepared?.input.batchId??null);setStorageStatus(`Budget and prepared batch saved (revision ${result.revision}). No ledger entries or emails were created.`);
  }catch(cause){setStorageStatus(cause instanceof Error?cause.message:"Financial preparation was not saved.");}
  finally{saveLock.current=false;setSaving(false);}
 }
 async function postApprovedBatch(){
  if(!canPost||reviewOnly||!persistenceReady||conflict||saveLock.current||postLock.current||!prepared||savedBatchId!==prepared.input.batchId||postedBatchId===prepared.input.batchId)return;
  const entryType=prepared.input.kind==="Demand"?"charges":"credits";
  if(!confirm(`Post this approved batch of ${prepared.rows.length} real ${entryType} to the unit ledgers?\n\nTotal: ${money(prepared.rows.reduce((sum,row)=>sum+row.amountPence,0))}\nBatch: ${prepared.input.batchId}\n\nThis changes financial accounts. No emails will be sent.`))return;
  postLock.current=true;setPosting(true);setStorageStatus("");
  try{
   const response=await fetch(`/api/blocks/${blockId}/financial-batches`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision,batchId:prepared.input.batchId,approved:true})});const result=await response.json();
   if(response.status===409)setConflict(true);
   if(!response.ok)throw new Error(result.error||"The ledger batch was not posted.");
   if(!Number.isInteger(result.imported)||result.imported<0)throw new Error("Ledger outcome could not be confirmed. Keep this saved batch identifier when checking or retrying.");
   setPostedBatchId(prepared.input.batchId);
   setStorageStatus(`Ledger batch confirmed: ${result.imported} entries.${Array.isArray(result.generated)&&result.generated.length?` Assigned: ${result.generated.slice(0,5).join(", ")}${result.generated.length>5?"…":""}.`:""} No emails were sent.`);
  }catch(cause){setStorageStatus(cause instanceof Error?cause.message:"Ledger outcome could not be confirmed. Keep this saved batch identifier when checking or retrying.");}
  finally{postLock.current=false;setPosting(false);}
 }
 function invalidate(){setDocuments([]);setPrepared(null);setError("");setLeaseConfirmed(false);setStorageStatus(reviewOnly?"Preview only: saving is disabled.":"Unsaved changes. Save explicitly to keep this preparation.");}
 function changeSchedule(id:string,patch:Partial<ScheduleForm>){invalidate();setSchedules(current=>current.map(schedule=>schedule.id===id?{...schedule,...patch}:schedule));}
 function prepare(){
  try{
   if(!leaseConfirmed)throw new Error("Confirm the schedule, percentages and dates against the leases before preparing.");
   if(!selectedUnits.length)throw new Error("This block has no units. Add units before preparing a batch.");
   const input:FinancialDraftInput={batchId:crypto.randomUUID(),blockId,kind,preparedDate:today,issueDate,dueDate,issueMode,frequency,yearStart,periodIndex,schedules:schedules.map(schedule=>({id:schedule.id,name:schedule.name,annualPence:parsePounds(schedule.amount),shares:selectedUnits.map(unit=>({unitId:unit.id,percentage:schedule.percentages[unit.id]??""}))}))};
   const rows=prepareFinancialDraft(input);
   if(!rows.length)throw new Error("This period has no non-zero allocations. Review the budget and period.");
   setDocuments([]);setPrepared({input,rows});setError("");setStorageStatus(reviewOnly?"Preview batch prepared; saving is disabled.":"Batch prepared. Save explicitly to retain it with this budget.");
  }catch(cause){setPrepared(null);setError(cause instanceof Error?cause.message:"Could not prepare this batch.");}
 }
 async function previewDocuments(){
  if(!prepared||generatingDocuments)return;
  const generation=++documentGeneration.current;
  setGeneratingDocuments(true);setError("");setDocuments([]);
  try{
   let result:readonly Readonly<FinancialDocumentSnapshot>[];
   if(reviewOnly){
    const state=validateFinancialState({version:1,blockId,kind,schedules,frequency,yearStart,periodIndex,issueMode,issueDate,dueDate,prepared},blockId,selectedUnits.map(unit=>unit.id),today);
    const block=blocks.find(item=>item.id===blockId);if(!block)throw new Error("Select a block.");
    result=await generateFinancialDocuments({state,revision:1,today,mode:"Draft",block,units:selectedUnits,settings:block.documentSettings});
   }else{
    if(savedBatchId!==prepared.input.batchId)throw new Error("Save this prepared batch before generating its documents.");
    const response=await fetch(`/api/blocks/${blockId}/financial-documents`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision,batchId:prepared.input.batchId,mode:"Draft"})});const data=await response.json();
    if(response.status===409)setConflict(true);
    if(!response.ok)throw new Error(data.error||"Documents could not be generated.");
    if(!Array.isArray(data.documents)||!data.documents.length)throw new Error("No document snapshots were returned.");
    result=data.documents;
   }
   if(generation!==documentGeneration.current)return;
   setDocuments(result);setDocumentUnit(result[0].unitId);
  }catch(cause){if(generation===documentGeneration.current)setError(cause instanceof Error?cause.message:"Documents could not be generated.");}
  finally{if(generation===documentGeneration.current)setGeneratingDocuments(false);}
 }
 function downloadDocument(snapshot:Readonly<FinancialDocumentSnapshot>,format:"html"|"text"){
  const url=URL.createObjectURL(new Blob([format==="html"?snapshot.html:snapshot.attachment.content],{type:format==="html"?"text/html;charset=utf-8":"text/plain;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download=format==="html"?snapshot.attachment.fileName.replace(/\.txt$/,".html"):snapshot.attachment.fileName;link.click();URL.revokeObjectURL(url);
 }
 function download(){
  if(!prepared)return;
  const data={format:"london-financial-review-v1",status:"Draft — requires manager approval; no ledger entries or emails created",approvalRequired:true,deliveryEnabled:false,postingEnabled:false,blockName:blocks.find(block=>block.id===blockId)?.name,...prepared,unitLabels:Object.fromEntries(selectedUnits.map(unit=>[unit.id,unit.unitNumber]))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download=`financial-draft-${prepared.input.batchId}.json`;link.click();URL.revokeObjectURL(url);
 }
 return <section className="panel tenant-card tenant-form">
  <div className="panel-head"><div><p className="eyebrow">FINANCIAL PREPARATION · REVIEW VERSION</p><h2>Lease budgets & bulk batches</h2></div></div>
  <p>Prepare lease schedule allocations and a bulk demand or surplus credit batch. Save the budget and prepared batch explicitly to retain them for this block; unsaved changes are lost when leaving or refreshing. Ledger posting requires an explicitly approved saved batch and enabled posting access. No email sending or automatic scheduling is activated here.</p>
  <div><button className="unit-secondary" disabled={reviewOnly||loading||saving||posting||generatingDocuments||!persistenceReady||conflict} onClick={()=>void savePreparation()}>{saving?"Saving…":"Save budget & prepared batch"}</button> <button className="unit-secondary" disabled={reviewOnly||loading||saving||posting||generatingDocuments||!blockId} onClick={()=>{if(confirm("Reload the saved financial preparation? Unsaved changes will be discarded."))setReload(current=>current+1);}}>Reload saved version</button></div>
  {storageStatus&&<p className="unit-message" role="status">{storageStatus}</p>}
  <fieldset disabled={loading||saving||posting||generatingDocuments} style={{border:0,padding:0,margin:0,minWidth:0}}>
  <div className="unit-select">
   <label>Block<select value={blockId} onChange={event=>{invalidate();setBlockId(Number(event.target.value));setSchedules([{id:"schedule-1",name:"",amount:"",percentages:{}}]);}}>{blocks.map(block=><option key={block.id} value={block.id}>{block.name}</option>)}</select></label>
   <label>Batch type<select value={kind} onChange={event=>{invalidate();setKind(event.target.value as typeof kind);}}><option>Demand</option><option>Surplus credit</option></select></label>
  </div>
  <p>Use each lease schedule’s actual percentages. Enter 0 for excluded units. Every schedule must total exactly 100%; equal shares are never assumed. Amounts are apportioned in pennies with rounding reconciled across units and instalments.</p>
  {schedules.map((schedule,index)=><fieldset key={schedule.id} style={{marginBottom:20,padding:16,border:"1px solid #d7d1c7"}}><legend>Lease schedule {index+1}</legend>
   <label>Schedule name / lease reference<input required maxLength={200} value={schedule.name} onChange={event=>changeSchedule(schedule.id,{name:event.target.value})}/></label>
   <label>{kind==="Demand"?"Annual budget (£)":"Total surplus to credit (£)"}<input type="number" min="0.01" max="9999999.99" step="0.01" value={schedule.amount} onChange={event=>changeSchedule(schedule.id,{amount:event.target.value})}/></label>
   <div className="block-table-wrap"><table><caption>Lease apportionment for {schedule.name||`schedule ${index+1}`}</caption><thead><tr><th>Unit</th><th>Lease percentage</th></tr></thead><tbody>{selectedUnits.map(unit=><tr key={unit.id}><td>{unit.unitNumber}</td><td><label><span className="eyebrow">{unit.unitNumber} share (%)</span><input aria-label={`${unit.unitNumber} percentage for schedule ${index+1}`} type="number" min="0" max="100" step="0.0001" value={schedule.percentages[unit.id]??""} onChange={event=>changeSchedule(schedule.id,{percentages:{...schedule.percentages,[unit.id]:event.target.value}})}/></label></td></tr>)}</tbody></table></div>
   {schedules.length>1&&<button className="unit-secondary" onClick={()=>{invalidate();setSchedules(current=>current.filter(item=>item.id!==schedule.id));}}>Remove schedule {index+1}</button>}
  </fieldset>)}
  <button className="unit-secondary" onClick={()=>{invalidate();setSchedules(current=>[...current,{id:crypto.randomUUID(),name:"",amount:"",percentages:{}}]);}}>Add lease schedule</button>
  {kind==="Demand"&&<><label>Demand frequency<select value={frequency} onChange={event=>{invalidate();setFrequency(event.target.value as DemandFrequency);setPeriodIndex(0);}}><option>Annual</option><option>Half-yearly</option><option>Quarterly</option><option>English quarters</option></select></label>
   <label>First charge-period start<input type="date" value={yearStart} onChange={event=>{invalidate();setYearStart(event.target.value);setPeriodIndex(0);}}/></label>
   {frequency==="English quarters"&&<p>English quarter days: 25 March, 24 June, 29 September and 25 December. Select a quarter day as the first start; lease terms control.</p>}
   <label>Period to prepare<select value={periodIndex} onChange={event=>{invalidate();setPeriodIndex(Number(event.target.value));}}>{periods.map((period,index)=><option key={period.start} value={index}>{period.start} to {period.end}</option>)}</select></label></>}
  <p>Preparation date: <strong>{today}</strong>. Charge period, planned issue and payment due date are separate. A future due date must be used for a demand prepared ahead of its payment date.</p>
  <label>Issue mode<select value={issueMode} onChange={event=>{invalidate();setIssueMode(event.target.value as typeof issueMode);if(event.target.value==="Issue now, future due date")setIssueDate(today);}}><option>Issue now, future due date</option><option>Schedule for later</option></select></label>
  <label>Planned issue date<input type="date" min={today} value={issueDate} readOnly={issueMode==="Issue now, future due date"} onChange={event=>{invalidate();setIssueDate(event.target.value);}}/></label>
  {kind==="Demand"&&<label>Payment due date<input type="date" min={issueDate} value={dueDate} onChange={event=>{invalidate();setDueDate(event.target.value);}}/></label>}
  <label><span><input type="checkbox" checked={leaseConfirmed} onChange={event=>{setLeaseConfirmed(event.target.checked);setPrepared(null);}}/> I have checked schedule amounts, apportionments, charge periods and payment dates against the leases.</span></label>
  <button className="primary" disabled={!blockId||!selectedUnits.length||!leaseConfirmed||!!prepared} onClick={prepare}>Prepare review batch</button>
  {error&&<p className="unit-message" role="alert">{error}</p>}
  {prepared&&<section aria-live="polite"><h3>Prepared batch · {prepared.rows.length} allocations · {money(prepared.rows.reduce((sum,row)=>sum+row.amountPence,0))}</h3><p>Batch ID: {prepared.input.batchId}. Repeated exports retain the same batch and row identifiers. A future posting or delivery integration must enforce these keys atomically before this can be activated.</p><div className="block-table-wrap"><table><caption>Draft allocations for manager review</caption><thead><tr><th>Unit</th><th>Schedule</th><th>Type</th><th>Amount</th><th>Period</th><th>Planned issue</th><th>Due</th></tr></thead><tbody>{prepared.rows.map(row=><tr key={row.idempotencyKey}><td>{selectedUnits.find(unit=>unit.id===row.unitId)?.unitNumber}</td><td>{row.scheduleName}</td><td>{row.entryType}</td><td>{money(row.amountPence)}</td><td>{row.chargePeriod?`${row.chargePeriod.start} – ${row.chargePeriod.end}`:"Surplus allocation"}</td><td>{row.plannedIssueDate}</td><td>{row.dueDate??"—"}</td></tr>)}</tbody></table></div><button className="unit-secondary" onClick={download}>Export review batch (JSON)</button>
   <p>{!canPost||reviewOnly?"Ledger posting is disabled in this review. The prepared batch can be saved or exported for approval.":savedBatchId!==prepared.input.batchId?"Save this prepared batch before posting to the ledger.":postedBatchId===prepared.input.batchId?"This batch has been confirmed in the ledger. No email was sent.":"Posting records real charges or credits. Review the saved amounts and dates before confirming."}</p>
   <button className="primary" disabled={!canPost||reviewOnly||loading||saving||posting||!persistenceReady||conflict||savedBatchId!==prepared.input.batchId||postedBatchId===prepared.input.batchId} onClick={()=>void postApprovedBatch()}>{posting?"Posting…":"Post approved batch to ledger"}</button>
   <button className="unit-secondary" disabled={generatingDocuments||(!reviewOnly&&savedBatchId!==prepared.input.batchId)} onClick={()=>void previewDocuments()}>{generatingDocuments?"Generating document snapshots…":"Preview demand / credit documents"}</button>
   {documents.length>0&&<section><h3>Document snapshots — draft preview</h3><p>Documents use this saved batch and verified ledger references where available. Generating or downloading them does not send an email or establish service. Download HTML and use your browser’s Print / Save PDF command for a PDF copy. The exact text snapshot is suitable for an email attachment.</p><label>Unit document<select value={documentUnit??""} onChange={event=>setDocumentUnit(Number(event.target.value))}>{documents.map(document=><option key={document.documentId} value={document.unitId}>{selectedUnits.find(unit=>unit.id===document.unitId)?.unitNumber??document.unitId}</option>)}</select></label>{documents.filter(document=>document.unitId===documentUnit).map(document=><article key={document.documentId}><p>{document.posted?"Matching ledger references verified.":"No complete matching ledger posting verified."} {document.missingRequirements.length?`Formal issue is blocked: ${document.missingRequirements.join("; ")}.`:"Formal issue still requires separate manager approval and dispatch."}</p><p>Snapshot SHA-256: {document.contentHash}</p><button className="unit-secondary" onClick={()=>downloadDocument(document,"html")}>Download HTML / print to PDF</button> <button className="unit-secondary" onClick={()=>downloadDocument(document,"text")}>Download exact text attachment</button><iframe sandbox="" title={`Draft ${document.kind} for unit ${document.unitId}`} srcDoc={document.html} style={{width:"100%",height:620,border:"1px solid #d7d1c7",marginTop:16}}/></article>)}</section>}
  </section>}
 </fieldset></section>;
}
