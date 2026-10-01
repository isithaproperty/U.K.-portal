"use client";
import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "../lib/supabase/browser";
import type {Block,BuildingSafetyRecord} from "./types";
import styles from "./BuildingSafetyRegister.module.css";

const mainSections=["BSC","Compliance Checks","Insurance","Mandatory Reporting","Resident Engagement","Incident Reporting","General Health & Safety"];
const bscCategories=["FRAEW","FRA","Fire Door Survey","PEEP","Structural Survey","Safety Case Report","Plans & Drawings","Fire Alarm Maintenance"];
const categories=[...bscCategories,"Compliance Checks","Insurance","Mandatory Reporting","Resident Engagement","Incident Reporting","General Health & Safety"];
const statuses=["Current","Action required","Expired","Under review"];
const folderDescriptions:Record<string,string>={
 FRAEW:"External wall fire review documents and supporting evidence.",
 FRA:"Fire risk assessments, reviews and action records.",
 "Fire Door Survey":"Fire door inspections, surveys and remedial records.",
 PEEP:"Personal Emergency Evacuation Plans and related records.",
 "Structural Survey":"Structural inspections, surveys and engineer reports.",
 "Safety Case Report":"Current safety case reports and supporting evidence.",
 "Plans & Drawings":"Building plans, fire plans, drawings and schematics.",
 "Fire Alarm Maintenance":"Fire alarm servicing, maintenance and test records."
};

export default function BuildingSafetyRegister({blocks,records}:{blocks:Block[];records:BuildingSafetyRecord[]}){
 const router=useRouter();
 const[selectedBlock,setSelectedBlock]=useState<number|null>(blocks[0]?.id??null);
 const[activeSection,setActiveSection]=useState<string>("BSC");
 const[activeCategory,setActiveCategory]=useState<string>("FRAEW");
 const[category,setCategory]=useState(categories[0]),[title,setTitle]=useState(""),[status,setStatus]=useState("Current"),[dueDate,setDueDate]=useState(""),[notes,setNotes]=useState(""),[file,setFile]=useState<File|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const blockRecords=useMemo(()=>records.filter(r=>selectedBlock===null||r.blockId===selectedBlock),[records,selectedBlock]);
 const visible=useMemo(()=>blockRecords.filter(r=>r.category===activeCategory),[blockRecords,activeCategory]);
 const categoryCounts=useMemo(()=>Object.fromEntries(categories.map(cat=>[cat,blockRecords.filter(r=>r.category===cat).length])),[blockRecords]);
 const block=blocks.find(b=>b.id===selectedBlock)??null;
 const sectionCategories=activeSection==="BSC"?bscCategories:[activeSection];

 function selectSection(section:string){setActiveSection(section);const next=section==="BSC"?bscCategories[0]:section;setActiveCategory(next);setCategory(next);}
 function selectFolder(cat:string){setActiveCategory(cat);setCategory(cat);setTitle("");setNotes("");setDueDate("");setFile(null);setMessage("");}

 async function addRecord(e:React.FormEvent){
  e.preventDefault();if(!selectedBlock)return;setBusy(true);setMessage("");
  const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user?.email){setMessage("Please sign in again.");setBusy(false);return;}
  let storagePath:string|null=null;
  if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-");storagePath=`${selectedBlock}/${crypto.randomUUID()}-${safe}`;const {error:uploadError}=await supabase.storage.from("building-safety-documents").upload(storagePath,file,{contentType:file.type||undefined});if(uploadError){setMessage("Document upload failed: "+uploadError.message);setBusy(false);return;}}
  const {error}=await supabase.from("building_safety_records").insert({block_id:selectedBlock,category,title:title.trim(),status,due_date:dueDate||null,notes:notes.trim(),file_name:file?.name??null,storage_path:storagePath,created_by:user.email.toLowerCase()});
  if(error){if(storagePath)await supabase.storage.from("building-safety-documents").remove([storagePath]);setMessage("Safety record could not be saved: "+error.message);setBusy(false);return;}
  setTitle("");setStatus("Current");setDueDate("");setNotes("");setFile(null);setMessage("Health & Safety record added.");setBusy(false);router.refresh();
 }
 async function openFile(record:BuildingSafetyRecord){if(!record.storagePath)return;const supabase=createClient();const {data,error}=await supabase.storage.from("building-safety-documents").createSignedUrl(record.storagePath,300);if(error||!data?.signedUrl){setMessage("Document could not be opened.");return;}window.open(data.signedUrl,"_blank","noopener,noreferrer");}
 async function remove(record:BuildingSafetyRecord){if(!confirm("Delete this health and safety record?"))return;const supabase=createClient();const {error}=await supabase.from("building_safety_records").delete().eq("id",record.id);if(error){setMessage("Record could not be deleted: "+error.message);return;}if(record.storagePath)await supabase.storage.from("building-safety-documents").remove([record.storagePath]);router.refresh();}

 const recordList=<>{visible.length?<div className={styles.cardGrid}>{visible.map((r,i)=><article key={r.id} className={styles.documentCard}><div className={`${styles.docIcon} ${styles[`tone${i%4}`]}`}>▣</div><div className={styles.docCopy}><h3>{r.title}</h3><p>{r.notes||"No notes added."}</p><div className={styles.meta}><span>{r.status}</span><span>{r.dueDate?"Review "+r.dueDate:"No review date"}</span><span>{r.fileName||"No attachment"}</span></div><div className={styles.cardActions}>{r.storagePath&&<button className="outline" onClick={()=>void openFile(r)}>Open document</button>}<button className={styles.deleteButton} onClick={()=>void remove(r)}>Delete</button></div></div></article>)}</div>:<div className={styles.emptyFolder}><span>▱</span><h3>This folder is empty</h3><p>Upload the first {activeCategory} document for this building.</p></div>}</>;

 return <section>
  <div className="page-head"><div><p className="eyebrow">HEALTH & SAFETY</p><h1>Golden Thread</h1><p>Building safety, compliance and health & safety records by block.</p></div></div>
  <div className="building-context"><label>Building<select value={selectedBlock??""} onChange={e=>setSelectedBlock(e.target.value?Number(e.target.value):null)}>{blocks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{block&&<div><span>{block.units} units</span><small>{block.address.replace(/\n/g,", ")}</small></div>}</div>
  <div className="tabs" role="tablist" aria-label="Health & Safety main sections">{mainSections.map(section=><button key={section} className={activeSection===section?"active":""} onClick={()=>selectSection(section)}>{section}</button>)}</div>

  {activeSection==="BSC"?<div className={styles.folderLayout}>
   <aside className={styles.folderSidebar}><div className={styles.sidebarHeading}><span>BSC</span><b>Document folders</b></div>{bscCategories.map(cat=><button key={cat} className={activeCategory===cat?styles.folderActive:""} onClick={()=>selectFolder(cat)}><span className={styles.folderIcon}>▰</span><span><b>{cat}</b><small>{categoryCounts[cat]??0} {(categoryCounts[cat]??0)===1?"document":"documents"}</small></span><i>›</i></button>)}</aside>
   <main className={styles.folderContent}><div className={styles.folderHead}><div><p className="eyebrow">BSC DOCUMENT FOLDER</p><h2>{activeCategory}</h2><p>{folderDescriptions[activeCategory]}</p></div><label className={styles.uploadButton}>＋ Upload document<input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label></div>
    {file&&<form className={styles.uploadForm} onSubmit={addRecord}><div className={styles.selectedFile}><b>{file.name}</b><span>Ready to upload to {activeCategory}</span></div><label>Document title<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder={`e.g. ${activeCategory} 2026`}/></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(x=><option key={x}>{x}</option>)}</select></label><label>Review / expiry date<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label><label className={styles.notes}>Notes<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></label><button className="primary" disabled={busy||!title.trim()}>{busy?"Uploading…":"Save document"}</button><button type="button" className="outline" onClick={()=>setFile(null)}>Cancel</button></form>}
    {recordList}
   </main>
  </div>:<div className="block-dashboard-grid">
   <section className="panel block-wo-form"><p className="eyebrow">ADD RECORD</p><h2>{activeSection} item</h2><form onSubmit={addRecord}><label>Title<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Document or certificate title"/></label><div className="wo-form-grid"><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(x=><option key={x}>{x}</option>)}</select></label><label>{activeSection==="Insurance"?"Policy renewal / expiry date":"Review / expiry date"}<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></div><label>Notes<textarea rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></label><label>PDF / image<input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button className="primary" disabled={busy||!title.trim()}>{busy?"Saving…":"Add health and safety record"}</button></form></section>
   <section className="panel"><div className="panel-head"><div><p className="eyebrow">THIS BUILDING</p><h2>{activeCategory}</h2><p>{visible.length} {visible.length===1?"record":"records"} in this category.</p></div></div>{recordList}</section>
  </div>}
  {message&&<p className="unit-message" role="status">{message}</p>}
 </section>
}
