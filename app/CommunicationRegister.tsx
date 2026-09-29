"use client";
import {useMemo,useState} from "react";
import {createClient} from "../lib/supabase/browser";
import type {Block,Resident} from "./types";

export default function CommunicationRegister({blocks,residents}:{blocks:Block[];residents:Resident[]}){
 const[selected,setSelected]=useState<number[]>([]);
 const[query,setQuery]=useState("");
 const[subject,setSubject]=useState("");
 const[message,setMessage]=useState("");
 const[busy,setBusy]=useState(false);
 const[status,setStatus]=useState("");

 const filtered=useMemo(()=>{
  const q=query.trim().toLowerCase();
  if(!q)return blocks;
  return blocks.filter(b=>[b.name,b.address,b.manager,b.managementCompany].some(v=>v.toLowerCase().includes(q)));
 },[blocks,query]);

 const selectedSet=useMemo(()=>new Set(selected),[selected]);
 const recipients=useMemo(()=>{
  const emails=residents.filter(r=>selectedSet.has(r.blockId)).map(r=>r.email.trim().toLowerCase()).filter(Boolean);
  return [...new Set(emails)];
 },[residents,selectedSet]);
 const selectedBlocks=blocks.filter(b=>selectedSet.has(b.id));

 function toggle(id:number){
  setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
 }
 function selectVisible(){
  setSelected(current=>[...new Set([...current,...filtered.map(b=>b.id)])]);
 }
 async function sendCommunication(){
  if(!selected.length||!subject.trim()||!message.trim())return;
  if(!recipients.length){setStatus("The selected blocks do not have any resident email addresses yet.");return;}
  const names=selectedBlocks.map(b=>b.name).join(", ");
  if(!confirm(`Send this communication to ${recipients.length} resident email address${recipients.length===1?"":"es"} across ${selected.length} selected block${selected.length===1?"":"s"}?\n\n${names}`))return;
  setBusy(true);setStatus("");
  const supabase=createClient();
  const {data,error}=await supabase.functions.invoke("resident-communication",{body:{blockIds:selected,subject:subject.trim(),message:message.trim()}});
  if(error){setStatus(error.message||"Communication could not be sent.");setBusy(false);return;}
  if(data?.error){setStatus(data.error+(data.missing?.length?": "+data.missing.join(", "):""));setBusy(false);return;}
  setStatus(`Communication sent to ${data.recipientCount} resident email address${data.recipientCount===1?"":"es"} across ${data.blockCount} block${data.blockCount===1?"":"s"}.`);
  setSubject("");setMessage("");setBusy(false);
 }

 return <section className="communications-page">
  <div className="page-head"><div><p className="eyebrow">COMMUNICATIONS</p><h1>Resident communications</h1><p>Select the exact blocks that should receive each communication.</p></div></div>

  <div className="communications-layout">
   <section className="panel communications-targets">
    <div className="panel-head"><div><p className="eyebrow">RECIPIENT BLOCKS</p><h2>Select blocks</h2><p>Only residents attached to selected blocks will be included.</p></div></div>
    <div className="communications-toolbar"><label>Find a block<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Block, address or manager…"/></label><div><button className="outline" onClick={selectVisible}>Select shown</button><button className="outline" onClick={()=>setSelected([])} disabled={!selected.length}>Clear</button></div></div>
    <div className="communication-block-grid">{filtered.map(block=>{
      const active=selectedSet.has(block.id);
      const residentCount=new Set(residents.filter(r=>r.blockId===block.id).map(r=>r.email.toLowerCase())).size;
      return <button key={block.id} className={`communication-block-card ${active?"selected":""}`} onClick={()=>toggle(block.id)} aria-pressed={active}><span className="communication-check">{active?"✓":""}</span><div><strong>{block.name}</strong><small>{block.address.replace(/\n/g,", ")}</small><em>{residentCount} resident email{residentCount===1?"":"s"}</em></div></button>
    })}</div>
   </section>

   <section className="panel communications-compose">
    <div className="panel-head"><div><p className="eyebrow">NEW COMMUNICATION</p><h2>Compose message</h2></div></div>
    <div className="communications-summary"><div><strong>{selected.length}</strong><span>Selected blocks</span></div><div><strong>{recipients.length}</strong><span>Resident emails</span></div></div>
    {selectedBlocks.length>0&&<div className="selected-block-tags">{selectedBlocks.map(b=><button key={b.id} onClick={()=>toggle(b.id)} title="Remove block">{b.name}<span>×</span></button>)}</div>}
    <label>Subject<input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Communication subject"/></label>
    <label>Message<textarea rows={10} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write the resident communication…"/></label>
    <div className="communication-send-note"><strong>Recipient protection</strong><p>Each resident receives an individual email. Email addresses are not exposed to other residents.</p></div>
    <button className="primary" disabled={busy||!selected.length||!recipients.length||!subject.trim()||!message.trim()} onClick={()=>void sendCommunication()}>{busy?"Sending…":`Send to ${recipients.length} resident${recipients.length===1?"":"s"}`}</button>
   </section>
  </div>
  {status&&<p className="unit-message" role="status">{status}</p>}
 </section>
}
