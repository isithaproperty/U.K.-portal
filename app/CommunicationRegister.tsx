"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {createClient} from "../lib/supabase/browser";
import {combineCommunicationRecipients,type CommunicationAudience,type CommunicationRecipient,type ResidentCommunicationSnapshot} from "../lib/communication-recipients";
import type {Block,Resident} from "./types";
type Preview={blockId:number;audience:CommunicationAudience;fingerprint:string;recipients:CommunicationRecipient[];residentSnapshot:ResidentCommunicationSnapshot[]};
type SendPayload={blockIds:number[];audience:CommunicationAudience;subject:string;message:string;requestId:string;previewFingerprints:Record<number,string>};
export default function CommunicationRegister({blocks,residents}:{blocks:Block[];residents:Resident[]}){
 const [selected,setSelected]=useState<number[]>([]),[query,setQuery]=useState(""),[subject,setSubject]=useState(""),[message,setMessage]=useState(""),[audience,setAudience]=useState<CommunicationAudience>("legacy-residents");
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(""),[previews,setPreviews]=useState<Preview[]>([]),[previewBusy,setPreviewBusy]=useState(false),[previewError,setPreviewError]=useState(""),[previewVersion,setPreviewVersion]=useState(0),[pendingId,setPendingId]=useState<string|null>(null);
 const pending=useRef<SendPayload|null>(null),sending=useRef(false);
 const selectedKey=[...selected].sort((a,b)=>a-b).join(",");
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return !q?blocks:blocks.filter(b=>[b.name,b.address,b.manager,b.managementCompany].some(v=>v.toLowerCase().includes(q)));},[blocks,query]);
 const selectedSet=useMemo(()=>new Set(selected),[selected]),selectedBlocks=blocks.filter(b=>selectedSet.has(b.id));
 const previewCurrent=previews.length===selected.length&&previews.every(p=>selectedSet.has(p.blockId)&&p.audience===audience);
 const {recipients}=useMemo(()=>combineCommunicationRecipients(previews),[previews]);
 useEffect(()=>{
  if(pendingId)return;
  const controller=new AbortController();let active=true;setPreviews([]);setPreviewError("");
  const ids=selectedKey?selectedKey.split(",").map(Number):[];
  if(!ids.length){setPreviewBusy(false);return ()=>controller.abort();}
  setPreviewBusy(true);
  async function load(){try{const data=await Promise.all(ids.map(async id=>{const response=await fetch(`/api/blocks/${id}/communication-recipients?audience=${audience}`,{cache:"no-store",signal:controller.signal});const body=await response.json();if(!response.ok)throw new Error(body.error||"Recipient preview failed.");if(body.blockId!==id||!Array.isArray(body.recipients)||!Array.isArray(body.residentSnapshot)||typeof body.fingerprint!=="string")throw new Error("Recipient preview was incomplete.");return body as Preview;}));if(active)setPreviews(data);}catch(error){if(active&&!controller.signal.aborted)setPreviewError(error instanceof Error?error.message:"Recipient preview unavailable.");}finally{if(active)setPreviewBusy(false);}}
  void load();return ()=>{active=false;controller.abort();};
 },[selectedKey,audience,previewVersion,pendingId]);
 function toggle(id:number){if(pendingId)return;setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);}
 function selectVisible(){if(!pendingId)setSelected(current=>[...new Set([...current,...filtered.map(b=>b.id)])]);}
 async function sendCommunication(){
  if(sending.current)return;
  if(!pending.current){
   if(!selected.length||previewBusy||previewError||!previewCurrent||!recipients.length||!subject.trim()||!message.trim())return;
   if(!confirm(`Send this block communication to the ${recipients.length} server-verified email address${recipients.length===1?"":"es"} shown below? Each email has one private recipient.\n\n${selectedBlocks.map(b=>b.name).join(", ")}`))return;
   pending.current={blockIds:[...selected].sort((a,b)=>a-b),audience,subject:subject.trim(),message:message.trim(),requestId:crypto.randomUUID(),previewFingerprints:Object.fromEntries(previews.map(p=>[p.blockId,p.fingerprint]))};setPendingId(pending.current.requestId);
  }
  sending.current=true;setBusy(true);setStatus("");
  try{
   const {data,error}=await createClient().functions.invoke("resident-communication",{body:pending.current});
   let result=data;
   if(error){if(error.context instanceof Response)try{result=await error.context.clone().json();}catch{}throw Object.assign(new Error(result?.error||error.message||"Communication outcome is uncertain; retain this request ID."),{result});}
   if(result?.error)throw Object.assign(new Error(result.error),{result});
   if(!result?.ok)throw new Error("Communication outcome was not confirmed. Retry the same request to verify it.");
   setStatus(`Email provider accepted ${result.recipientCount} individual emails across ${result.blockCount} blocks${result.replayed?" (earlier completed request verified)":""}. Portal copies apply only to matching registered resident assignments; extra contacts gain no portal access.`);
   pending.current=null;setPendingId(null);setSubject("");setMessage("");setPreviewVersion(v=>v+1);
  }catch(error){const result=(error as {result?:{previewChanged?:boolean;missing?:string[]}}).result;if(result?.previewChanged){pending.current=null;setPendingId(null);setPreviewVersion(v=>v+1);}setStatus((error instanceof Error?error.message:"Communication outcome is uncertain.")+(result?.missing?.length?` Missing: ${result.missing.join(", ")}`:""));}
  finally{sending.current=false;setBusy(false);}
 }
 function abandonRequest(){if(busy)return;if(!confirm("A previous attempt may already have sent some emails. Verify the delivery history before starting a separate request. Abandon this retry ID?"))return;pending.current=null;setPendingId(null);setPreviewVersion(v=>v+1);setStatus("Retry ID abandoned. Verify provider history before sending the same content again.");}
 return <section className="communications-page"><div className="page-head"><div><p className="eyebrow">COMMUNICATIONS</p><h1>Block communications</h1><p>Select exact blocks and review the server recipient list before sending.</p></div></div>
 <div className="communications-layout"><section className="panel communications-targets"><div className="panel-head"><div><p className="eyebrow">RECIPIENT BLOCKS</p><h2>Select blocks</h2><p>Saved contact mode includes opted-in leaseholders, tenants and recognised associations for general block information only.</p></div></div><div className="communications-toolbar"><label>Find a block<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Block, address or manager…"/></label><div><button className="outline" disabled={!!pendingId} onClick={selectVisible}>Select shown</button><button className="outline" onClick={()=>setSelected([])} disabled={!selected.length||!!pendingId}>Clear</button></div></div><div className="communication-block-grid">{filtered.map(block=>{const active=selectedSet.has(block.id),registered=residents.filter(r=>r.blockId===block.id&&!r.archivedAt).length;return <button key={block.id} disabled={!!pendingId} className={`communication-block-card ${active?"selected":""}`} onClick={()=>toggle(block.id)} aria-pressed={active}><span className="communication-check">{active?"✓":""}</span><div><strong>{block.name}</strong><small>{block.address.replace(/\n/g,", ")}</small><em>{registered} registered resident assignments</em></div></button>;})}</div></section>
 <section className="panel communications-compose"><div className="panel-head"><div><p className="eyebrow">NEW COMMUNICATION</p><h2>Compose block information</h2></div></div><label>Audience<select disabled={!!pendingId} value={audience} onChange={e=>setAudience(e.target.value as CommunicationAudience)}><option value="legacy-residents">Registered residents (existing assignments)</option><option value="saved-contacts">Saved communication contacts (leaseholders + tenants)</option></select></label><p>{audience==="saved-contacts"?"Uses saved contact preferences from Leaseholders & Section 20. Unsaved contact edits are excluded.":"Preserves the existing resident assignment audience. Additional saved contact emails are excluded."} Demands and statutory notices use their separate reviewed workflows.</p>
 <div className="communications-summary"><div><strong>{selected.length}</strong><span>Selected blocks</span></div><div><strong>{previewBusy||!previewCurrent?"…":recipients.length}</strong><span>Server-verified emails</span></div></div>{selectedBlocks.length>0&&<div className="selected-block-tags">{selectedBlocks.map(b=><button disabled={!!pendingId} key={b.id} onClick={()=>toggle(b.id)} title="Remove block">{b.name}<span>×</span></button>)}</div>}
 <button className="outline" disabled={previewBusy||!!pendingId||!selected.length} onClick={()=>setPreviewVersion(v=>v+1)}>Refresh recipient preview</button>{previewError&&<p className="unit-message" role="alert">{previewError}</p>}{!previewBusy&&previewCurrent&&!previewError&&!!selected.length&&<details><summary>Review {recipients.length} exact recipient emails</summary><ul>{recipients.map(r=><li key={r.email}>{r.email} · {blocks.filter(b=>r.blockIds.includes(b.id)).map(b=>b.name).join(", ")}</li>)}</ul>{!recipients.length&&<p>No eligible email addresses in this audience.</p>}</details>}
 <label>Subject<input disabled={!!pendingId} maxLength={200} value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Communication subject"/></label><label>Message<textarea disabled={!!pendingId} maxLength={10000} rows={10} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write general block information…"/></label><div className="communication-send-note"><strong>Recipient protection</strong><p>Each email has one recipient. Only a matching existing resident assignment receives a portal copy. Contact emails do not create assignments or portal access.</p></div>
 {pendingId&&<p className="unit-message">Request ID: {pendingId}. Keep this ID for any retry or outcome check. Content and recipients stay fixed until this attempt is resolved.</p>}
 <button className="primary" disabled={busy||(!pendingId&&(previewBusy||!!previewError||!previewCurrent||!selected.length||!recipients.length||!subject.trim()||!message.trim()))} onClick={()=>void sendCommunication()}>{busy?"Checking / sending…":pendingId?"Retry / verify same request":`Send to ${recipients.length} email${recipients.length===1?"":"s"}`}</button>{pendingId&&<button className="outline" disabled={busy} onClick={abandonRequest}>Abandon retry ID after checking history</button>}</section></div>{status&&<p className="unit-message" role="status">{status}</p>}</section>;
}
