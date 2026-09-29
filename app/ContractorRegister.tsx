"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "../lib/supabase/browser";
import type {Contractor,ContractorDocument} from "./types";

const trades=["General","Plumbing","Electrical","Lift","Fire safety","Cleaning","Security","Grounds","Fabric","Mechanical","Other"];
const docTypes=["Public Liability","Employers Liability","Health & Safety Policy","RAMS / Method Statement","Accreditation / Licence","Gas Safe","NICEIC","Fire Certification","Lift Certification","DBS / Site Access","Other"];

export default function ContractorRegister({contractors,documents}:{contractors:Contractor[];documents:ContractorDocument[]}){
 const router=useRouter();
 const refreshedOnOpen=useRef(false);
 useEffect(()=>{if(refreshedOnOpen.current)return;refreshedOnOpen.current=true;router.refresh();},[router]);
 const[selectedId,setSelectedId]=useState<number|null>(contractors[0]?.id??null);
 const[editTrade,setEditTrade]=useState("General"),[editEmail,setEditEmail]=useState(""),[editPhone,setEditPhone]=useState("");
 const[company,setCompany]=useState(""),[contact,setContact]=useState(""),[email,setEmail]=useState(""),[phone,setPhone]=useState(""),[trade,setTrade]=useState("General"),[registration,setRegistration]=useState(""),[vat,setVat]=useState(""),[notes,setNotes]=useState("");
 const[docType,setDocType]=useState("Public Liability"),[expiry,setExpiry]=useState(""),[docNotes,setDocNotes]=useState(""),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const selected=contractors.find(c=>c.id===selectedId)??null;
 useEffect(()=>{if(!selected)return;setEditTrade(selected.trade||"General");setEditEmail(selected.email||"");setEditPhone(selected.phone||"");},[selectedId,selected?.trade,selected?.email,selected?.phone]);
 const selectedDocs=useMemo(()=>documents.filter(d=>d.contractorId===selectedId),[documents,selectedId]);
 const now=new Date();now.setHours(0,0,0,0);
 const expired=(d:ContractorDocument)=>d.expiryDate?new Date(d.expiryDate+"T00:00:00")<now:false;
 const expiring=(d:ContractorDocument)=>{if(!d.expiryDate)return false;const date=new Date(d.expiryDate+"T00:00:00");return date>=now&&date.getTime()-now.getTime()<=30*86400000};
 const expiredCount=documents.filter(expired).length, expiringCount=documents.filter(expiring).length;
 async function addContractor(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user?.email){setMessage("Please sign in again.");setBusy(false);return;}
  const {data,error}=await supabase.from("contractors").insert({company_name:company.trim(),contact_name:contact.trim()||null,email:email.trim().toLowerCase()||null,phone:phone.trim()||null,trade,company_registration:registration.trim()||null,vat_number:vat.trim()||null,notes:notes.trim(),created_by:user.email.toLowerCase()}).select("id").single();
  if(error){setMessage(error.code==="23505"?"That contractor already exists.":"Contractor could not be saved.");setBusy(false);return;}
  setCompany("");setContact("");setEmail("");setPhone("");setTrade("General");setRegistration("");setVat("");setNotes("");setSelectedId(data.id);setMessage("Contractor added.");setBusy(false);router.refresh();
 }
 async function saveContractorDetails(){
  if(!selected)return;setBusy(true);setMessage("");
  const supabase=createClient();
  const {error}=await supabase.from("contractors").update({trade:editTrade,email:editEmail.trim().toLowerCase()||null,phone:editPhone.trim()||null,updated_at:new Date().toISOString()}).eq("id",selected.id);
  if(error){setMessage("Contractor details could not be updated.");setBusy(false);return;}
  setMessage("Contractor details updated.");setBusy(false);router.refresh();
 }
 async function setStatus(status:Contractor["status"]){
  if(!selected)return;const supabase=createClient();const {error}=await supabase.from("contractors").update({status,updated_at:new Date().toISOString()}).eq("id",selected.id);if(!error)router.refresh();
 }
 async function uploadDocument(e:React.FormEvent){
  e.preventDefault();if(!selected||!file)return;setBusy(true);setMessage("");
  const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user?.email){setMessage("Please sign in again.");setBusy(false);return;}
  const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-");
  const path=`${selected.id}/${crypto.randomUUID()}-${safe}`;
  const {error:uploadError}=await supabase.storage.from("contractor-documents").upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(uploadError){setMessage("Document upload failed.");setBusy(false);return;}
  const {error}=await supabase.from("contractor_documents").insert({contractor_id:selected.id,document_type:docType,file_name:file.name,storage_path:path,mime_type:file.type||null,file_size:file.size,expiry_date:expiry||null,notes:docNotes.trim(),uploaded_by:user.email.toLowerCase()});
  if(error){await supabase.storage.from("contractor-documents").remove([path]);setMessage("Document record could not be saved.");setBusy(false);return;}
  setFile(null);setExpiry("");setDocNotes("");setMessage("Document uploaded.");setBusy(false);router.refresh();
 }
 async function openDocument(doc:ContractorDocument){
  const supabase=createClient();const {data,error}=await supabase.storage.from("contractor-documents").createSignedUrl(doc.storagePath,300);
  if(error||!data?.signedUrl){setMessage("Document could not be opened.");return;}window.open(data.signedUrl,"_blank","noopener,noreferrer");
 }
 async function deleteDocument(doc:ContractorDocument){
  if(!confirm("Delete this contractor document?"))return;const supabase=createClient();
  const {error}=await supabase.from("contractor_documents").delete().eq("id",doc.id);if(error){setMessage("Document could not be deleted.");return;}
  await supabase.storage.from("contractor-documents").remove([doc.storagePath]);router.refresh();
 }
 return <section className="contractor-page">
  <div className="page-head"><div><p className="eyebrow">CONTRACTOR MANAGEMENT</p><h1>Contractors</h1><p>Manage approved suppliers, compliance documents and expiry dates before issuing work.</p></div><button className="outline" onClick={()=>router.refresh()}>Refresh suppliers</button></div>
  <section className="stat-grid three"><article className="stat blue"><div><span>Contractors</span><strong>{contractors.length}</strong><small>Live supplier records</small></div><i>♢</i></article><article className="stat green"><div><span>Approved</span><strong>{contractors.filter(c=>c.status==="Approved").length}</strong><small>Available for work orders</small></div><i>✓</i></article><article className="stat amber"><div><span>Document alerts</span><strong>{expiredCount+expiringCount}</strong><small>{expiredCount} expired · {expiringCount} due in 30 days</small></div><i>!</i></article></section>
  <div className="contractor-layout">
   <section className="panel contractor-add"><p className="eyebrow">NEW CONTRACTOR</p><h2>Add contractor</h2><form onSubmit={addContractor}><label>Company name<input required value={company} onChange={e=>setCompany(e.target.value)}/></label><div className="contractor-form-grid"><label>Main contact<input value={contact} onChange={e=>setContact(e.target.value)}/></label><label>Trade<select value={trade} onChange={e=>setTrade(e.target.value)}>{trades.map(x=><option key={x}>{x}</option>)}</select></label><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Phone<input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label>Company registration<input value={registration} onChange={e=>setRegistration(e.target.value)}/></label><label>VAT number<input value={vat} onChange={e=>setVat(e.target.value)}/></label></div><label>Notes<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)}/></label><button className="primary" disabled={busy||!company.trim()}>Add contractor</button></form></section>
   <section className="panel contractor-list"><div className="panel-head"><div><p className="eyebrow">SUPPLIER REGISTER</p><h2>Contractor companies</h2></div></div>{contractors.length?contractors.map(c=>{const docs=documents.filter(d=>d.contractorId===c.id);const bad=docs.filter(expired).length;return <button key={c.id} className={`contractor-row ${selectedId===c.id?"active":""}`} onClick={()=>setSelectedId(c.id)}><div><b>{c.companyName}</b><span>{c.trade} · {c.email||"No email"} · {c.phone||"No phone"}</span></div><div><strong className={`contractor-status ${c.status.toLowerCase()}`}>{c.status}</strong><small>{docs.length} docs{bad? ` · ${bad} expired`:""}</small></div></button>}):<p className="block-empty-inline">No contractors added yet.</p>}</section>
  </div>
  {selected&&<section className="panel contractor-detail"><div className="contractor-detail-head"><div><p className="eyebrow">CONTRACTOR RECORD</p><h2>{selected.companyName}</h2><p>{selected.trade} · {selected.email||"No email"} · {selected.phone||"No phone"}</p></div><div><span className={`contractor-status ${selected.status.toLowerCase()}`}>{selected.status}</span><button className="outline" onClick={()=>void setStatus(selected.status==="Approved"?"Suspended":"Approved")}>{selected.status==="Approved"?"Suspend":"Approve contractor"}</button></div></div>
   <div className="contractor-detail-grid"><section><h3>Company details</h3><div className="contractor-form-grid"><label>Trade<select value={editTrade} onChange={e=>setEditTrade(e.target.value)}>{trades.map(x=><option key={x}>{x}</option>)}</select></label><label>Email<input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)}/></label><label>Phone<input value={editPhone} onChange={e=>setEditPhone(e.target.value)}/></label></div><button className="primary" type="button" disabled={busy} onClick={()=>void saveContractorDetails()}>Save contractor details</button><dl><div><dt>Contact</dt><dd>{selected.contactName||"—"}</dd></div><div><dt>Registration</dt><dd>{selected.companyRegistration||"—"}</dd></div><div><dt>VAT</dt><dd>{selected.vatNumber||"—"}</dd></div><div><dt>Notes</dt><dd>{selected.notes||"—"}</dd></div></dl></section><section><h3>Upload compliance document</h3><form onSubmit={uploadDocument}><label>Document type<select value={docType} onChange={e=>setDocType(e.target.value)}>{docTypes.map(x=><option key={x}>{x}</option>)}</select></label><label>Expiry date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label><label>PDF / image<input required type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><label>Notes<input value={docNotes} onChange={e=>setDocNotes(e.target.value)}/></label><button className="primary" disabled={busy||!file}>Upload document</button></form></section></div>
   <div className="contractor-documents"><div className="panel-head"><div><p className="eyebrow">COMPLIANCE PACK</p><h2>Documents</h2></div></div>{selectedDocs.length?<div className="block-table-wrap"><table className="block-table"><thead><tr><th>Document</th><th>File</th><th>Expiry</th><th>Status</th><th></th></tr></thead><tbody>{selectedDocs.map(doc=><tr key={doc.id}><td><strong>{doc.documentType}</strong></td><td>{doc.fileName}</td><td>{doc.expiryDate||"No expiry"}</td><td><span className={`doc-status ${expired(doc)?"expired":expiring(doc)?"expiring":"valid"}`}>{expired(doc)?"Expired":expiring(doc)?"Expiring soon":"Current"}</span></td><td><div className="doc-actions"><button onClick={()=>void openDocument(doc)}>Open</button><button onClick={()=>void deleteDocument(doc)}>Delete</button></div></td></tr>)}</tbody></table></div>:<p className="block-empty-inline">No compliance documents uploaded yet.</p>}</div>
  </section>}
  {message&&<p className="unit-message" role="status">{message}</p>}
 </section>
}
