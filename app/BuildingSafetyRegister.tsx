"use client";
import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "../lib/supabase/browser";
import type {Block,BuildingSafetyRecord} from "./types";

const categories=["Insurance","Building registration","Safety case","Fire safety","Structural safety","Plans & drawings","Maintenance & inspections","Changes & refurbishments","Mandatory occurrences","Incidents & emergencies","Resident engagement","Complaints & concerns","Audit & assurance"];
const statuses=["Current","Action required","Expired","Under review"];

export default function BuildingSafetyRegister({blocks,records}:{blocks:Block[];records:BuildingSafetyRecord[]}){
 const router=useRouter();
 const[selectedBlock,setSelectedBlock]=useState<number|null>(blocks[0]?.id??null);
 const[activeCategory,setActiveCategory]=useState<string>("All");
 const[category,setCategory]=useState(categories[0]),[title,setTitle]=useState(""),[status,setStatus]=useState("Current"),[dueDate,setDueDate]=useState(""),[notes,setNotes]=useState(""),[file,setFile]=useState<File|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const blockRecords=useMemo(()=>records.filter(r=>selectedBlock===null||r.blockId===selectedBlock),[records,selectedBlock]);
 const visible=useMemo(()=>blockRecords.filter(r=>activeCategory==="All"||r.category===activeCategory),[blockRecords,activeCategory]);
 const categoryCounts=useMemo(()=>Object.fromEntries(categories.map(cat=>[cat,blockRecords.filter(r=>r.category===cat).length])),[blockRecords]);
 const block=blocks.find(b=>b.id===selectedBlock)??null;

 async function addRecord(e:React.FormEvent){
  e.preventDefault(); if(!selectedBlock)return; setBusy(true);setMessage("");
  const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user?.email){setMessage("Please sign in again.");setBusy(false);return;}
  let storagePath:string|null=null;
  if(file){
    const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-");
    storagePath=`${selectedBlock}/${crypto.randomUUID()}-${safe}`;
    const {error:uploadError}=await supabase.storage.from("building-safety-documents").upload(storagePath,file,{contentType:file.type||undefined});
    if(uploadError){setMessage("Document upload failed: "+uploadError.message);setBusy(false);return;}
  }
  const {error}=await supabase.from("building_safety_records").insert({
    block_id:selectedBlock,category,title:title.trim(),status,due_date:dueDate||null,notes:notes.trim(),file_name:file?.name??null,storage_path:storagePath,created_by:user.email.toLowerCase()
  });
  if(error){if(storagePath)await supabase.storage.from("building-safety-documents").remove([storagePath]);setMessage("Safety record could not be saved: "+error.message);setBusy(false);return;}
  setTitle("");setStatus("Current");setDueDate("");setNotes("");setFile(null);setMessage("Building safety record added.");setBusy(false);router.refresh();
 }
 async function openFile(record:BuildingSafetyRecord){
  if(!record.storagePath)return;const supabase=createClient();const {data,error}=await supabase.storage.from("building-safety-documents").createSignedUrl(record.storagePath,300);
  if(error||!data?.signedUrl){setMessage("Document could not be opened.");return;}window.open(data.signedUrl,"_blank","noopener,noreferrer");
 }
 async function remove(record:BuildingSafetyRecord){
  if(!confirm("Delete this building safety record?"))return;const supabase=createClient();
  const {error}=await supabase.from("building_safety_records").delete().eq("id",record.id);
  if(error){setMessage("Record could not be deleted: "+error.message);return;}
  if(record.storagePath)await supabase.storage.from("building-safety-documents").remove([record.storagePath]);router.refresh();
 }

 return <section>
  <div className="page-head"><div><p className="eyebrow">BUILDING SAFETY</p><h1>Golden Thread</h1><p>Add and monitor live safety/compliance records by block.</p></div></div>
  <div className="building-context"><label>Building<select value={selectedBlock??""} onChange={e=>setSelectedBlock(e.target.value?Number(e.target.value):null)}>{blocks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{block&&<div><span>{block.units} units</span><small>{block.address.replace(/\n/g,", ")}</small></div>}</div>
  <div className="safety-category-tabs" role="tablist" aria-label="Building safety categories"><button className={activeCategory==="All"?"active":""} onClick={()=>setActiveCategory("All")}>All <span>{blockRecords.length}</span></button>{categories.map(cat=><button key={cat} className={activeCategory===cat?"active":""} onClick={()=>{setActiveCategory(cat);setCategory(cat);}}>{cat} <span>{categoryCounts[cat]??0}</span></button>)}</div>
  <div className="block-dashboard-grid">
   <section className="panel block-wo-form"><p className="eyebrow">ADD RECORD</p><h2>Building safety item</h2><form onSubmit={addRecord}><label>Category<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(x=><option key={x}>{x}</option>)}</select></label><label>Title<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder={category==="Insurance"?"e.g. Buildings insurance policy":"e.g. Fire risk assessment"}/></label><div className="wo-form-grid"><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(x=><option key={x}>{x}</option>)}</select></label><label>{category==="Insurance"?"Policy renewal / expiry date":"Review / expiry date"}<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></div><label>{category==="Insurance"?"Policy details (insurer, policy number, cover and broker)":"Notes"}<textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></label><label>PDF / image<input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button className="primary" disabled={busy||!title.trim()}>{busy?"Saving…":"Add building safety record"}</button></form></section>
   <section className="panel"><div className="panel-head"><div><p className="eyebrow">THIS BUILDING</p><h2>{activeCategory==="All"?"Safety register":activeCategory}</h2><p>{activeCategory==="All"?"All building-safety records for this block.":`${visible.length} ${visible.length===1?"record":"records"} in this category.`}</p></div></div>{visible.length?<div className="wo-list">{visible.map(r=><article key={r.id} className="wo-card"><div className="wo-card-main"><div className="wo-card-title"><b>{r.title}</b><span>{r.category}</span></div><p>{r.notes||"No notes"}</p><div className="wo-meta"><span>{r.status}</span><span>{r.dueDate?"Due "+r.dueDate:"No review date"}</span><span>{r.fileName||"No attachment"}</span></div></div><div className="wo-card-controls">{r.storagePath&&<button className="outline" onClick={()=>void openFile(r)}>Open document</button>}<button className="outline" onClick={()=>void remove(r)}>Delete</button></div></article>)}</div>:<p className="block-empty-inline">{activeCategory==="All"?"No building-safety records have been added for this block yet.":`No ${activeCategory.toLowerCase()} records have been added for this block yet.`}</p>}</section>
  </div>
  {message&&<p className="unit-message" role="status">{message}</p>}
 </section>
}
