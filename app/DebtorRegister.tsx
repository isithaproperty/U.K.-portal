"use client";
import {useEffect, useRef, useState} from "react";
import type {Block, Resident, Unit} from "./types";
import {money, type ChargeEntry} from "../lib/service-charges";
import {agedAccount, captureReminder, readDebtorReviewState, retainReminder, standingOrderAction, type ReminderDraft, type StandingOrderMode} from "../lib/debtors";

type Props = {blocks:Block[]; units:Unit[]; residents:Resident[]; entries:ChargeEntry[]; today:string;reviewOnly?:boolean};
function download(fileName:string, text:string, type="text/plain") {
 const url=URL.createObjectURL(new Blob([text], {type}));
 const a=document.createElement("a"); a.href=url; a.download=fileName; a.click(); URL.revokeObjectURL(url);
}
export default function DebtorRegister({blocks, units, entries, today,reviewOnly=false}:Props) {
 const [blockId,setBlockId]=useState(blocks[0]?.id??0), [unitId,setUnitId]=useState<number|null>(null);
 const [notes,setNotes]=useState<Record<number,string>>({}), [history,setHistory]=useState<ReminderDraft[]>([]);
 const [stage,setStage]=useState<ReminderDraft["stage"]>("First reminder"), [recipients,setRecipients]=useState("");
 const [subject,setSubject]=useState(""), [body,setBody]=useState(""), [status,setStatus]=useState("");
 const [mode,setMode]=useState<StandingOrderMode>("Payment allocation review"), [receipt,setReceipt]=useState("");
 const [loadedBlock,setLoadedBlock]=useState<number|null>(null),[revision,setRevision]=useState(0),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[loadVersion,setLoadVersion]=useState(0),[loadError,setLoadError]=useState("");
 const generation=useRef(0),saveInFlight=useRef(false);
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
 const available=units.filter(u=>u.blockId===blockId), selected=available.find(u=>u.id===unitId)??available[0];
 const accounts=available.map(unit=>({unit,aged:agedAccount(entries.filter(e=>e.block_id===blockId&&e.unit_id===unit.id),today)}));
 const current=accounts.find(a=>a.unit.id===selected?.id);
 const note=selected&&stateReady?notes[selected.id]??"":"";
 const outstanding=current?current.aged.days1to30+current.aged.days31to60+current.aged.days61to90+current.aged.days91plus:0;
 function resetComposer() {setRecipients("");setSubject("");setBody("");setReceipt("");setStatus("");requestId.current=null;}
 function prepare() {
  if(!selected||!current||!stateReady||saving)return;
  try {
   requestId.current??=crypto.randomUUID();
   const attachment=[`Account review as at ${today}`,`Block: ${blocks.find(b=>b.id===blockId)?.name??blockId}`,`Unit: ${selected.unitNumber}`,`Payment reference: ${selected.paymentReference??"Not recorded"}`,`Account balance: ${money(current.aged.balance)}`,`Overdue: ${money(outstanding)}`,"",...entries.filter(e=>e.block_id===blockId&&e.unit_id===selected.id&&e.entry_date<=today).map(e=>`${e.reference} | ${e.entry_type} | ${e.entry_date} | Due ${e.due_date??"—"} | ${money(e.amount_pence)} | ${e.description}`)].join("\n");
   const draft=captureReminder({id:requestId.current,unitId:selected.id,stage,preparedAt:new Date().toISOString(),recipients:recipients.split(/[;,\n]/),subject,body,accountNote:note,attachment:{fileName:`account-${selected.id}-${today}.txt`,mediaType:"text/plain",content:attachment}});
   setHistory(previous=>retainReminder(previous,draft));setDirty(true);setStatus("Draft captured with the exact email, document snapshot and internal note. Save review state to retain it. Nothing was sent.");
  } catch(error) {setStatus(error instanceof Error?error.message:"Could not capture draft.");}
 }
 const revise=()=>{requestId.current=null;setStatus("");};
 function reloadState(){if(dirty&&!confirm("Reload saved review records? Export your local drafts first; unsaved changes will be discarded."))return;setLoadVersion(version=>version+1);}
 return <section>
  <div className="page-head"><div><p className="eyebrow">DEBTORS · REVIEW VERSION</p><h1>Debtors and reminders</h1><p>Ageing uses recorded payments and credits against the oldest due charges. {reviewOnly?"Synthetic preview: drafts stay in this tab until exported.":"Save account notes and exact reminder snapshots to this block’s manager review records."}</p></div></div>
  <section className="panel tenant-card"><label>Development<select disabled={saving} value={blockId} onChange={e=>{if(dirty&&!confirm("Change block and discard unsaved review changes? Save or export them first to retain them."))return;setLoadedBlock(null);setBlockId(Number(e.target.value));setUnitId(null);resetComposer();}}>{blocks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <p role="status">{loadError?loadError:!stateReady?"Debtor review state is not loaded; editing is disabled.":reviewOnly?"Synthetic review only — no server requests.":`${dirty?"Unsaved changes":"Saved review state"} · revision ${revision}`}</p>
   {!reviewOnly&&<><button className="primary" disabled={!stateReady||saving||!dirty} onClick={()=>void saveState()}>{saving?"Saving…":"Save review state"}</button><button className="unit-secondary" disabled={saving} onClick={reloadState}>Reload saved review state</button><button className="unit-secondary" disabled={!stateReady&&!dirty} onClick={()=>download(`debtor-review-${blockId}.json`,JSON.stringify({blockId,revision,state:{notes,history,mode,receipt}},null,2),"application/json")}>Export local review state</button></>}
   <div className="block-table-wrap"><table><caption>Aged analysis as at {today}. Due today is included in not overdue.</caption><thead><tr><th>Unit</th><th>Balance</th><th>Not overdue</th><th>1–30 days</th><th>31–60 days</th><th>61–90 days</th><th>91+ days</th><th>Last recorded payment</th><th>Demand sent</th></tr></thead><tbody>{accounts.map(({unit,aged})=><tr key={unit.id}><td><button className="unit-secondary" onClick={()=>{setUnitId(unit.id);resetComposer();}}>{unit.unitNumber}</button></td><td>{money(aged.balance)}</td><td>{money(aged.notDue)}</td><td>{money(aged.days1to30)}</td><td>{money(aged.days31to60)}</td><td>{money(aged.days61to90)}</td><td>{money(aged.days91plus)}</td><td>{aged.lastPayment?`${aged.lastPayment.entry_date} · ${money(aged.lastPayment.amount_pence)} · ${aged.lastPayment.reference}`:"No payment recorded"}</td><td>Delivery history not recorded in ledger</td></tr>)}</tbody></table></div>
   {!accounts.length&&<p>No unit accounts in this development.</p>}
   <button className="unit-secondary" disabled={!accounts.length} onClick={()=>download(`aged-analysis-${blockId}-${today}.json`,JSON.stringify({asOf:today,blockId,accounts},null,2),"application/json")}>Export aged analysis</button>
  </section>
  {selected&&current&&<><fieldset disabled={!stateReady||saving} style={{border:0,padding:0,margin:0}}><div className="tenant-grid"><section className="panel tenant-card tenant-form"><h2>Unit {selected.unitNumber} · account notes</h2><label>Internal account note<textarea rows={4} value={note} onChange={e=>{setNotes(previous=>({...previous,[selected.id]:e.target.value}));setDirty(true);revise();}}/></label><p>The note carries into this account’s reminder review record. It is excluded from the resident document.</p>
   <h3>Standing order handling</h3><label>Review action<select value={stateReady?mode:"Payment allocation review"} onChange={e=>{setMode(e.target.value as StandingOrderMode);setDirty(true);}}><option>Payment allocation review</option><option>Invoice preparation review</option></select></label><label>Recorded bank receipt reference<input value={stateReady?receipt:""} onChange={e=>{setReceipt(e.target.value);setDirty(true);}} placeholder="Only after a bank receipt exists"/></label><p>{standingOrderAction(stateReady?mode:"Payment allocation review",stateReady?receipt:"")}</p><p>These choices do not activate an automation or record a payment.</p>
  </section><section className="panel tenant-card tenant-form"><h2>Prepare a reminder</h2><p>Overdue balance: {money(outstanding)}. Verify the leaseholder recipients before preparing a draft; resident contact records do not establish ownership.</p><label>Reminder stage<select value={stage} onChange={e=>{setStage(e.target.value as ReminderDraft["stage"]);revise();}}><option>First reminder</option><option>Final reminder</option></select></label><label>Verified leaseholder email addresses<textarea rows={2} value={stateReady?recipients:""} onChange={e=>{setRecipients(e.target.value);revise();}} placeholder="Separate addresses with commas"/></label><label>Exact email subject<input value={stateReady?subject:""} onChange={e=>{setSubject(e.target.value);revise();}}/></label><label>Exact email message<textarea rows={6} value={stateReady?body:""} onChange={e=>{setBody(e.target.value);revise();}}/></label><p>The attached text account snapshot contains posted entries as of {today}. Review document requirements before issuing a real reminder.</p><button className="primary" onClick={prepare}>Capture reminder draft</button></section></div></fieldset>
  {stateReady&&<section className="panel tenant-card"><h2>Reminder review history · unit {selected.unitNumber}</h2><p>Draft preparation dates are separate from send dates. No delivery is claimed.</p>{history.filter(h=>h.unitId===selected.id).map(item=><details key={item.id}><summary>{item.stage} · {item.preparedAt} · {item.deliveryStatus}</summary><p><strong>To:</strong> {item.recipients.join(", ")}</p><p><strong>Subject:</strong> {item.subject}</p><pre style={{whiteSpace:"pre-wrap"}}>{item.body}</pre><p><strong>Internal note:</strong> {item.accountNote||"None"}</p><pre style={{whiteSpace:"pre-wrap"}}>{item.attachment.content}</pre><button className="unit-secondary" onClick={()=>download(item.attachment.fileName,item.attachment.content)}>Download exact attachment</button><button className="unit-secondary" onClick={()=>download(`reminder-draft-${item.id}.json`,JSON.stringify(item,null,2),"application/json")}>Export exact review record</button></details>)}{!history.some(h=>h.unitId===selected.id)&&<p>No reminder drafts prepared for this account.</p>}</section>}</>}
  {status&&<p className="unit-message" role="status">{status}</p>}
 </section>;
}
