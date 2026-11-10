"use client";
import {buildChaserDocument,type ChaserDocument} from "../lib/chaser-document";
import {useEffect, useRef, useState} from "react";
import type {Block, Resident, Unit} from "./types";
import {money, type ChargeEntry} from "../lib/service-charges";
import {agedAccount, captureReminder, readDebtorReviewState, retainReminder, standingOrderAction, type ReminderDraft, type StandingOrderMode} from "../lib/debtors";

type Props = {blocks:Block[]; units:Unit[]; residents:Resident[]; entries:ChargeEntry[]; today:string;reviewOnly?:boolean};
function download(fileName:string, text:string, type="text/plain") {
 const url=URL.createObjectURL(new Blob([text], {type}));
 const a=document.createElement("a"); a.href=url; a.download=fileName; a.click(); URL.revokeObjectURL(url);
}
type SentHistory={idempotency_key:string;unit_id:number;kind:string;status:string;sent_at:string|null;scheduled_at:string;delivery_status:string;envelope:{subject:string;body:string;attachments:{fileName:string;content:string;encoding:string}[]}};
export default function DebtorRegister({blocks, units, entries, today,reviewOnly=false}:Props) {
 const [sentSummaries,setSentSummaries]=useState<{unit_id:number;last_demand_sent:string|null}[]>([]);
 const [sentHistory,setSentHistory]=useState<SentHistory[]>([]),[sentError,setSentError]=useState("");
 const [blockId,setBlockId]=useState(blocks[0]?.id??0), [unitId,setUnitId]=useState<number|null>(null);
 const [notes,setNotes]=useState<Record<number,string>>({}), [history,setHistory]=useState<ReminderDraft[]>([]);
 const [stage,setStage]=useState<ReminderDraft["stage"]>("First reminder"), [recipients,setRecipients]=useState("");
 const [subject,setSubject]=useState(""), [body,setBody]=useState(""), [status,setStatus]=useState("");
 const [mode,setMode]=useState<StandingOrderMode>("Payment allocation review"), [receipt,setReceipt]=useState("");
 const [loadedBlock,setLoadedBlock]=useState<number|null>(null),[revision,setRevision]=useState(0),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[loadVersion,setLoadVersion]=useState(0),[loadError,setLoadError]=useState("");
 const [chaser,setChaser]=useState<ChaserDocument|null>(null),[chaserBusy,setChaserBusy]=useState(false);
 const [statementStart,setStatementStart]=useState(`${today.slice(0,4)}-01-01`),[recipientName,setRecipientName]=useState(""),[recipientAddress,setRecipientAddress]=useState(""),[landlordAddress,setLandlordAddress]=useState(""),[legalReviewed,setLegalReviewed]=useState(false);
 const chaserGeneration=useRef(0);
 const generation=useRef(0),saveInFlight=useRef(false);
 useEffect(()=>()=>{chaserGeneration.current++;},[]);
 const requestId=useRef<string|null>(null);
 const unitsKey=units.filter(unit=>unit.blockId===blockId).map(unit=>unit.id).sort((a,b)=>a-b).join(",");
 useEffect(()=>{
  const token=++generation.current,controller=new AbortController();
  setLoadedBlock(null);setNotes({});setHistory([]);setMode("Payment allocation review");setReceipt("");setRevision(0);setDirty(false);setLoadError("");setSaving(false);saveInFlight.current=false;requestId.current=null;
  if(reviewOnly){setLoadedBlock(blockId);return()=>{controller.abort();};}
  if(!blockId){setLoadError("Select an accessible block to load debtor review records.");return()=>controller.abort();}
  async function load(){
   try{
    const response=await fetch(`/api/blocks/${blockId}/management-review/debtors`,{signal:controller.signal,cache:"no-store"});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error??"Could not load debtor review records.");
    if(!Number.isSafeInteger(result.revision)||result.revision<0)throw new Error("The saved review revision is invalid.");
    const state=readDebtorReviewState(result.state,unitsKey?unitsKey.split(",").map(Number):[]);
    if(token!==generation.current||controller.signal.aborted)return;
    setNotes(state.notes);setHistory(state.history);setMode(state.mode);setReceipt(state.receipt);setRevision(result.revision);setLoadedBlock(blockId);
   }catch(error){if(token===generation.current&&!controller.signal.aborted)setLoadError(error instanceof Error?error.message:"Could not load debtor review records.");}
  }
  void load();
  return()=>{controller.abort();generation.current++;};
 },[blockId,reviewOnly,unitsKey,loadVersion]);
 const stateReady=loadedBlock===blockId;
 async function saveState(){
  if(reviewOnly||!stateReady||saveInFlight.current||!dirty)return;
  const token=generation.current;
  saveInFlight.current=true;setSaving(true);setStatus("");
  try{
   const response=await fetch(`/api/blocks/${blockId}/management-review/debtors`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:{notes,history,mode,receipt},revision})});
   const result=await response.json();
   if(token!==generation.current)return;
   if(response.status===409){setLoadedBlock(null);throw new Error("Another manager saved this block. Export your local drafts, then reload the saved version before making further changes.");}
   if(!response.ok)throw new Error(result.error??"Could not save debtor review records.");
   if(!Number.isSafeInteger(result.revision)||result.revision<=revision)throw new Error("Save response could not be verified. Reload the saved version before retrying.");
   setRevision(result.revision);setDirty(false);setStatus("Account notes, reminder snapshots and standing-order review settings saved. No reminder was sent or payment posted.");
  }catch(error){if(token===generation.current)setStatus(error instanceof Error?error.message:"Could not save debtor review records.");}
  finally{if(token===generation.current){setSaving(false);saveInFlight.current=false;}}
 }
 useEffect(()=>{const controller=new AbortController();setSentHistory([]);setSentSummaries([]);setSentError("");if(!reviewOnly)void fetch(`/api/blocks/${blockId}/demand-history`,{signal:controller.signal,cache:"no-store"}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);if(!controller.signal.aborted){setSentHistory(data.records??[]);setSentSummaries(data.summaries??[]);}}).catch(error=>{if(!controller.signal.aborted)setSentError(error instanceof Error?error.message:"Delivery history unavailable.");});return()=>controller.abort();},[blockId,reviewOnly,loadVersion]);
 const available=units.filter(u=>u.blockId===blockId), selected=available.find(u=>u.id===unitId)??available[0];
 const accounts=available.map(unit=>({unit,aged:agedAccount(entries.filter(e=>e.block_id===blockId&&e.unit_id===unit.id),today)}));
 const current=accounts.find(a=>a.unit.id===selected?.id);
 const note=selected&&stateReady?notes[selected.id]??"":"";
 const outstanding=current?current.aged.days1to30+current.aged.days31to60+current.aged.days61to90+current.aged.days91plus:0;
 function resetComposer() {chaserGeneration.current++;setChaser(null);setChaserBusy(false);setRecipientName("");setRecipientAddress("");setLandlordAddress("");setLegalReviewed(false);setRecipients("");setSubject("");setBody("");setReceipt("");setStatus("");requestId.current=null;}
 function invalidateChaser(){chaserGeneration.current++;setChaserBusy(false);setChaser(null);requestId.current=null;}
 async function previewChaser(){
  if(!selected||!stateReady||chaserBusy)return;
  const token=++chaserGeneration.current;setChaserBusy(true);setChaser(null);setStatus("");
  try{
   const block=blocks.find(item=>item.id===blockId);if(!block)throw Error("Select a building.");
   let verifiedEntries=entries;
   if(!reviewOnly){const response=await fetch(`/api/blocks/${blockId}/statement?start=${statementStart}&end=${today}`,{cache:"no-store"});const data=await response.json();if(!response.ok)throw Error(data.error||"Could not verify complete account records.");if(!Array.isArray(data.entries)||!data.units?.some((unit:Unit)=>unit.id===selected.id&&unit.blockId===blockId))throw Error("Unit scope could not be verified.");verifiedEntries=data.entries;}
   const result=buildChaserDocument({block,unit:selected,entries:verifiedEntries,asOf:today,statementStart,recipient:recipientName,recipientAddress,landlordAddress,legalReviewed,stage});
   if(token!==chaserGeneration.current)return;setChaser(result);requestId.current=null;setStatus("Draft chaser preview prepared from recorded account entries. Nothing was sent.");
  }catch(error){if(token===chaserGeneration.current)setStatus(error instanceof Error?error.message:"Could not prepare preview.");}
  finally{if(token===chaserGeneration.current)setChaserBusy(false);}
 }
 function prepare() {
  if(!selected||!current||!stateReady||saving)return;
  try {
   requestId.current??=crypto.randomUUID();
   if(!chaser||chaser.unitId!==selected.id||chaser.blockId!==blockId)throw new Error("Preview and review the chaser from current recorded entries before capturing the draft.");
   const attachment=chaser.text;
   const draft=captureReminder({id:requestId.current,unitId:selected.id,stage,preparedAt:new Date().toISOString(),recipients:recipients.split(/[;,\n]/),subject,body,accountNote:note,attachment:{fileName:`account-${selected.id}-${today}.txt`,mediaType:"text/plain",content:attachment}});
   setHistory(previous=>retainReminder(previous,draft));setDirty(true);setStatus("Draft captured with the exact email, document snapshot and internal note. Save review state to retain it. Nothing was sent.");
  } catch(error) {setStatus(error instanceof Error?error.message:"Could not capture draft.");}
 }
 const revise=()=>{requestId.current=null;setStatus("");};
 function reloadState(){invalidateChaser();if(dirty&&!confirm("Reload saved review records? Export your local drafts first; unsaved changes will be discarded."))return;setLoadVersion(version=>version+1);}
 return <section>
  <div className="page-head"><div><p className="eyebrow">DEBTORS · REVIEW VERSION</p><h1>Debtors and reminders</h1><p>Ageing uses recorded payments and credits against the oldest due charges. {reviewOnly?"Synthetic preview: drafts stay in this tab until exported.":"Save account notes and exact reminder snapshots to this block’s manager review records."}</p></div></div>
  <section className="panel tenant-card"><label>Development<select disabled={saving} value={blockId} onChange={e=>{if(dirty&&!confirm("Change block and discard unsaved review changes? Save or export them first to retain them."))return;setLoadedBlock(null);setBlockId(Number(e.target.value));setUnitId(null);resetComposer();}}>{blocks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <p role="status">{loadError?loadError:!stateReady?"Debtor review state is not loaded; editing is disabled.":reviewOnly?"Synthetic review only — no server requests.":`${dirty?"Unsaved changes":"Saved review state"} · revision ${revision}`}</p>
   {!reviewOnly&&<><button className="primary" disabled={!stateReady||saving||!dirty} onClick={()=>void saveState()}>{saving?"Saving…":"Save review state"}</button><button className="unit-secondary" disabled={saving} onClick={reloadState}>Reload saved review state</button><button className="unit-secondary" disabled={!stateReady&&!dirty} onClick={()=>download(`debtor-review-${blockId}.json`,JSON.stringify({blockId,revision,state:{notes,history,mode,receipt}},null,2),"application/json")}>Export local review state</button></>}
   <div className="block-table-wrap"><table><caption>Aged analysis as at {today}. Due today is included in not overdue.</caption><thead><tr><th>Unit</th><th>Balance</th><th>Not overdue</th><th>1–30 days</th><th>31–60 days</th><th>61–90 days</th><th>91+ days</th><th>Last recorded payment</th><th>Demand sent</th></tr></thead><tbody>{accounts.map(({unit,aged})=><tr key={unit.id}><td><button className="unit-secondary" onClick={()=>{setUnitId(unit.id);resetComposer();}}>{unit.unitNumber}</button></td><td>{money(aged.balance)}</td><td>{money(aged.notDue)}</td><td>{money(aged.days1to30)}</td><td>{money(aged.days31to60)}</td><td>{money(aged.days61to90)}</td><td>{money(aged.days91plus)}</td><td>{aged.lastPayment?`${aged.lastPayment.entry_date} · ${money(aged.lastPayment.amount_pence)} · ${aged.lastPayment.reference}`:"No payment recorded"}</td><td>{sentError?"Delivery history unavailable":sentSummaries.find(h=>h.unit_id===unit.id)?.last_demand_sent??"No demand send recorded"}</td></tr>)}</tbody></table></div>
   {!accounts.length&&<p>No unit accounts in this development.</p>}
   <button className="unit-secondary" disabled={!accounts.length} onClick={()=>download(`aged-analysis-${blockId}-${today}.json`,JSON.stringify({asOf:today,blockId,accounts},null,2),"application/json")}>Export aged analysis</button>
  </section>
  {selected&&current&&<><fieldset disabled={!stateReady||saving} style={{border:0,padding:0,margin:0}}><div className="tenant-grid"><section className="panel tenant-card tenant-form"><h2>Unit {selected.unitNumber} · account notes</h2><label>Internal account note<textarea rows={4} value={note} onChange={e=>{setNotes(previous=>({...previous,[selected.id]:e.target.value}));setDirty(true);revise();}}/></label><p>The note carries into this account’s reminder review record. It is excluded from the resident document.</p>
   <h3>Standing order handling</h3><label>Review action<select value={stateReady?mode:"Payment allocation review"} onChange={e=>{setMode(e.target.value as StandingOrderMode);setDirty(true);}}><option>Payment allocation review</option><option>Invoice preparation review</option></select></label><label>Recorded bank receipt reference<input value={stateReady?receipt:""} onChange={e=>{setReceipt(e.target.value);setDirty(true);}} placeholder="Only after a bank receipt exists"/></label><p>{standingOrderAction(stateReady?mode:"Payment allocation review",stateReady?receipt:"")}</p><p>These choices do not activate an automation or record a payment.</p>
  </section><section className="panel tenant-card tenant-form"><h2>Prepare a reminder</h2><p>Overdue balance {chaser?"(refreshed for preview)":"(initial view; refresh before use)"}: {money(chaser?.overduePence??outstanding)}. Verify the leaseholder recipients before preparing a draft; resident contact records do not establish ownership.</p><label>Reminder stage<select value={stage} onChange={e=>{setStage(e.target.value as ReminderDraft["stage"]);invalidateChaser();revise();}}><option>First reminder</option><option>Final reminder</option></select></label><label>Verified leaseholder email addresses<textarea rows={2} value={stateReady?recipients:""} onChange={e=>{setRecipients(e.target.value);revise();}} placeholder="Separate addresses with commas"/></label><label>Exact email subject<input value={stateReady?subject:""} onChange={e=>{setSubject(e.target.value);revise();}}/></label><label>Exact email message<textarea rows={6} value={stateReady?body:""} onChange={e=>{setBody(e.target.value);revise();}}/></label><h3>Chaser letter preview</h3><label>Statement opening date<input type="date" max={today} value={statementStart} onChange={e=>{setStatementStart(e.target.value);invalidateChaser();}}/></label><label>Verified leaseholder name<input value={recipientName} maxLength={2000} onChange={e=>{setRecipientName(e.target.value);invalidateChaser();}}/></label><label>Verified correspondence address<textarea value={recipientAddress} maxLength={2000} onChange={e=>{setRecipientAddress(e.target.value);invalidateChaser();}}/></label><label>Confirmed landlord address (Section 47)<textarea value={landlordAddress} maxLength={2000} onChange={e=>{setLandlordAddress(e.target.value);invalidateChaser();}}/></label><label><input type="checkbox" checked={legalReviewed} onChange={e=>{setLegalReviewed(e.target.checked);invalidateChaser();}}/> I have reviewed the lease, notice wording and applicable rights summary. This remains an unsent draft.</label><p>Refreshes the complete recorded ledger before preview. Only the overdue amount is requested; future charges, unmatched bank imports, new fees and legal threats are not added. Check for payments received since this snapshot before issuing.</p><button className="unit-secondary" disabled={chaserBusy} onClick={()=>void previewChaser()}>{chaserBusy?"Checking account…":"Preview chaser letter"}</button>{chaser&&<><iframe sandbox="" title="Draft request for payment" srcDoc={chaser.html} style={{width:"100%",height:650,border:"1px solid #ccc"}}/><button className="unit-secondary" onClick={()=>download(`draft-chaser-${selected.id}-${today}.html`,chaser.html,"text/html")}>Download draft HTML / print to PDF</button><p>Prepared from the ledger as at {chaser.asOf}. Legal/payment review warnings remain in the draft. Existing delivery controls are unchanged.</p></>}<p>The captured attachment is the exact plain-text version of this chaser. HTML is a local preview only and is not automatically dispatched.</p><button className="primary" disabled={!chaser||chaserBusy} onClick={prepare}>Capture reminder draft</button></section></div></fieldset>
  {stateReady&&<section className="panel tenant-card"><h2>Reminder review history · unit {selected.unitNumber}</h2><p>Draft preparation dates are separate from send dates. No delivery is claimed.</p>{history.filter(h=>h.unitId===selected.id).map(item=><details key={item.id}><summary>{item.stage} · {item.preparedAt} · {item.deliveryStatus}</summary><p><strong>To:</strong> {item.recipients.join(", ")}</p><p><strong>Subject:</strong> {item.subject}</p><pre style={{whiteSpace:"pre-wrap"}}>{item.body}</pre><p><strong>Internal note:</strong> {item.accountNote||"None"}</p><pre style={{whiteSpace:"pre-wrap"}}>{item.attachment.content}</pre><button className="unit-secondary" onClick={()=>download(item.attachment.fileName,item.attachment.content)}>Download exact attachment</button><button className="unit-secondary" onClick={()=>download(`reminder-draft-${item.id}.json`,JSON.stringify(item,null,2),"application/json")}>Export exact review record</button></details>)}{!history.some(h=>h.unitId===selected.id)&&<p>No reminder drafts prepared for this account.</p>}</section>}</>}
  <section className="panel"><h2>Demand and reminder submission history</h2><p>Latest 500 recorded submissions for this block. A sent date is provider acceptance; delivery evidence is separate.</p>{sentError&&<p>{sentError}</p>}{sentHistory.filter(h=>h.unit_id===selected?.id).map(h=><details key={h.idempotency_key}><summary>{h.kind} · {h.sent_at??"Not sent"} · {h.status} · {h.delivery_status}</summary><h3>{h.envelope.subject}</h3><pre>{h.envelope.body}</pre>{h.envelope.attachments.map((a,i)=><details key={i}><summary>Exact attachment: {a.fileName}</summary><pre>{a.encoding==="utf8"?a.content:"Binary attachment preserved in Delivery & alerts"}</pre></details>)}</details>)}</section>
  {status&&<p className="unit-message" role="status">{status}</p>}
 </section>;
}
