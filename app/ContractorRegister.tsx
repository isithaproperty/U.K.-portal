"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "../lib/supabase/browser";
import type {Contractor,ContractorDocument} from "./types";

const trades=["General","Plumbing","Electrical","Gas","Lift","Fire safety","Cleaning","Security","Grounds","Fabric","Mechanical","Asbestos","Other"];
const docTypes=["Public Liability Insurance","Employers Liability Insurance","Health & Safety Policy","Competence / Qualifications","RAMS / Method Statement","Gas Safe Registration","Electrical Competence / Scheme Evidence","Fire Safety Competence / Certification","Lift Engineer Competence","SIA Licence Evidence","Waste Carrier Registration","HSE Asbestos Licence","Asbestos Training","Professional Indemnity Insurance","Grounds / Plant / Pesticide Competence","Accreditation / Licence","DBS / Site Access","Other"];

export default function ContractorRegister({contractors,documents}:{contractors:Contractor[];documents:ContractorDocument[]}){
 const router=useRouter();
 const refreshedOnOpen=useRef(false);
 useEffect(()=>{if(refreshedOnOpen.current)return;refreshedOnOpen.current=true;router.refresh();},[router]);
 const[selectedId,setSelectedId]=useState<number|null>(contractors[0]?.id??null);
 const[editTrade,setEditTrade]=useState("General"),[editEmail,setEditEmail]=useState(""),[editPhone,setEditPhone]=useState("");
 const[selectedTrades,setSelectedTrades]=useState<string[]>([]),[employeeCount,setEmployeeCount]=useState(""),[transportsWaste,setTransportsWaste]=useState(false),[undertakesDesign,setUndertakesDesign]=useState(false),[undertakesAsbestos,setUndertakesAsbestos]=useState(false),[usesSubcontractors,setUsesSubcontractors]=useState(false),[onboardingStatus,setOnboardingStatus]=useState("Incomplete"),[declarationName,setDeclarationName]=useState(""),[declarationAccepted,setDeclarationAccepted]=useState(false),[onboardingBusy,setOnboardingBusy]=useState(false);
 const[company,setCompany]=useState(""),[contact,setContact]=useState(""),[email,setEmail]=useState(""),[phone,setPhone]=useState(""),[trade,setTrade]=useState("General"),[registration,setRegistration]=useState(""),[vat,setVat]=useState(""),[notes,setNotes]=useState("");
 const[docType,setDocType]=useState("Public Liability"),[expiry,setExpiry]=useState(""),[docNotes,setDocNotes]=useState(""),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[onboardingLink,setOnboardingLink]=useState("");
 const[emailSubject,setEmailSubject]=useState(""),[emailMessage,setEmailMessage]=useState(""),[emailBusy,setEmailBusy]=useState(false);
 const selected=contractors.find(c=>c.id===selectedId)??null;
 useEffect(()=>{if(!selected)return;setEditTrade(selected.trade||"General");setEditEmail(selected.email||"");setEditPhone(selected.phone||"");const supabase=createClient();void Promise.all([supabase.from("contractor_trades").select("trade").eq("contractor_id",selected.id),supabase.from("contractor_onboarding").select("employee_count,transports_waste,undertakes_design,undertakes_asbestos,uses_subcontractors,onboarding_status,declaration_name,declaration_accepted_at").eq("contractor_id",selected.id).maybeSingle()]).then(([tradeResult,onboardingResult])=>{setSelectedTrades((tradeResult.data??[]).map((r:{trade:string})=>r.trade));const o=onboardingResult.data;if(o){setEmployeeCount(o.employee_count===null||o.employee_count===undefined?"":String(o.employee_count));setTransportsWaste(Boolean(o.transports_waste));setUndertakesDesign(Boolean(o.undertakes_design));setUndertakesAsbestos(Boolean(o.undertakes_asbestos));setUsesSubcontractors(Boolean(o.uses_subcontractors));setOnboardingStatus(o.onboarding_status||"Incomplete");setDeclarationName(o.declaration_name||"");setDeclarationAccepted(Boolean(o.declaration_accepted_at));}});},[selectedId,selected?.trade,selected?.email,selected?.phone]);
 const selectedDocs=useMemo(()=>documents.filter(d=>d.contractorId===selectedId),[documents,selectedId]);
 const now=new Date();now.setHours(0,0,0,0);
 const expired=(d:ContractorDocument)=>d.expiryDate?new Date(d.expiryDate+"T00:00:00")<now:false;
 const expiring=(d:ContractorDocument)=>{if(!d.expiryDate)return false;const date=new Date(d.expiryDate+"T00:00:00");return date>=now&&date.getTime()-now.getTime()<=30*86400000};
 const expiredCount=documents.filter(expired).length, expiringCount=documents.filter(expiring).length;
 const selectedDocTypes=new Set(selectedDocs.map(d=>d.documentType));
 const employeeNumber=employeeCount===""?null:Number(employeeCount);
 const requirements=useMemo(()=>{
   const items:{type:string;reason:string;required:boolean}[]=[
    {type:"Public Liability Insurance",reason:"AVIAF contractor onboarding requirement.",required:true},
    {type:"Competence / Qualifications",reason:"Evidence of skills, knowledge and experience appropriate to the work.",required:true},
    {type:"RAMS / Method Statement",reason:"Sample RAMS / method statement to demonstrate safe planning. Task-specific RAMS may still be required per job.",required:true},
    {type:"Health & Safety Policy",reason:employeeNumber!==null&&employeeNumber>=5?"Written policy required where the business has 5 or more employees.":"Health & safety arrangements / policy evidence.",required:true},
    {type:"Employers Liability Insurance",reason:"Required for employers in Great Britain, normally with at least £5m cover, subject to statutory exemptions.",required:employeeNumber!==null&&employeeNumber>0},
   ];
   if(selectedTrades.includes("Gas"))items.push({type:"Gas Safe Registration",reason:"Required for legal gas work in the UK.",required:true});
   if(selectedTrades.includes("Electrical"))items.push({type:"Electrical Competence / Scheme Evidence",reason:"Evidence of electrical competence and, where relevant, self-certification scheme registration.",required:true});
   if(selectedTrades.includes("Fire safety"))items.push({type:"Fire Safety Competence / Certification",reason:"Evidence of competence / third-party certification appropriate to the fire-safety service.",required:true});
   if(selectedTrades.includes("Lift"))items.push({type:"Lift Engineer Competence",reason:"Evidence of competent lift engineering capability.",required:true});
   if(selectedTrades.includes("Security"))items.push({type:"SIA Licence Evidence",reason:"Required where the security activity is licensable.",required:true});
   if(selectedTrades.includes("Asbestos")||undertakesAsbestos){items.push({type:"Asbestos Training",reason:"Training appropriate to the asbestos work undertaken.",required:true});items.push({type:"HSE Asbestos Licence",reason:"Required where the contractor undertakes licensable asbestos work.",required:undertakesAsbestos});}
   if(selectedTrades.includes("Grounds"))items.push({type:"Grounds / Plant / Pesticide Competence",reason:"Relevant competence evidence for plant, chainsaws, pesticides or other grounds activities as applicable.",required:true});
   if(transportsWaste)items.push({type:"Waste Carrier Registration",reason:"Required where the business transports waste and registration applies.",required:true});
   if(undertakesDesign)items.push({type:"Professional Indemnity Insurance",reason:"AVIAF requirement where the contractor undertakes design or professional advice.",required:true});
   return items;
 },[selectedTrades,employeeNumber,transportsWaste,undertakesDesign,undertakesAsbestos]);
 const requiredRequirements=requirements.filter(r=>r.required);
 const completeRequirements=requiredRequirements.filter(r=>selectedDocTypes.has(r.type));
 const onboardingComplete=selectedTrades.length>0&&requiredRequirements.length===completeRequirements.length&&declarationAccepted&&Boolean(declarationName.trim());

 async function addContractor(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user?.email){setMessage("Please sign in again.");setBusy(false);return;}
  const {data,error}=await supabase.from("contractors").insert({company_name:company.trim(),contact_name:contact.trim()||null,email:email.trim().toLowerCase()||null,phone:phone.trim()||null,trade,company_registration:registration.trim()||null,vat_number:vat.trim()||null,notes:notes.trim(),created_by:user.email.toLowerCase()}).select("id").single();
  if(error){setMessage(error.code==="23505"?"That contractor already exists.":"Contractor could not be saved.");setBusy(false);return;}
  setCompany("");setContact("");setEmail("");setPhone("");setTrade("General");setRegistration("");setVat("");setNotes("");setSelectedId(data.id);setMessage("Contractor added.");setBusy(false);router.refresh();
 }
 async function toggleTrade(value:string){
  if(!selected)return;
  const next=selectedTrades.includes(value)?selectedTrades.filter(x=>x!==value):[...selectedTrades,value];
  setSelectedTrades(next);
  const supabase=createClient();
  if(next.includes(value)){await supabase.from("contractor_trades").upsert({contractor_id:selected.id,trade:value},{onConflict:"contractor_id,trade"});}
  else{await supabase.from("contractor_trades").delete().eq("contractor_id",selected.id).eq("trade",value);}
  const primary=next[0]||"General";
  await supabase.from("contractors").update({trade:primary,updated_at:new Date().toISOString()}).eq("id",selected.id);
  router.refresh();
 }
 async function saveOnboarding(){
  if(!selected)return;setOnboardingBusy(true);setMessage("");
  const supabase=createClient();
  const payload={contractor_id:selected.id,employee_count:employeeCount===""?null:Number(employeeCount),transports_waste:transportsWaste,undertakes_design:undertakesDesign,undertakes_asbestos:undertakesAsbestos,uses_subcontractors:usesSubcontractors,onboarding_status:onboardingComplete?"Ready for review":"Incomplete",declaration_name:declarationName.trim()||null,declaration_accepted_at:declarationAccepted?new Date().toISOString():null,updated_at:new Date().toISOString()};
  const {error}=await supabase.from("contractor_onboarding").upsert(payload,{onConflict:"contractor_id"});
  if(error){setMessage("Onboarding details could not be saved.");setOnboardingBusy(false);return;}
  setOnboardingStatus(onboardingComplete?"Ready for review":"Incomplete");setMessage(onboardingComplete?"Onboarding pack ready for review.":"Onboarding saved. Required items are still outstanding.");setOnboardingBusy(false);router.refresh();
 }
 async function approveOnboarding(){
  if(!selected||!onboardingComplete)return;setOnboardingBusy(true);
  const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();
  const nowIso=new Date().toISOString();
  const {error}=await supabase.from("contractor_onboarding").update({onboarding_status:"Approved",reviewed_by:user?.email?.toLowerCase()||null,reviewed_at:nowIso,updated_at:nowIso}).eq("contractor_id",selected.id);
  if(!error){await supabase.from("contractors").update({status:"Approved",updated_at:nowIso}).eq("id",selected.id);setOnboardingStatus("Approved");setMessage("Contractor onboarding approved.");await invokeEmail("onboarding_approved");router.refresh();}else setMessage("Onboarding approval failed.");
  setOnboardingBusy(false);
 }
 async function invokeEmail(eventType:string,extra:Record<string,unknown>={}){
  if(!selected)return {ok:false};
  const supabase=createClient();
  const {data,error}=await supabase.functions.invoke("contractor-email",{body:{contractorId:selected.id,eventType,...extra}});
  if(error){setMessage(error.message||"Email could not be sent.");return {ok:false};}
  if(data?.error){setMessage(data.error+(data.missing?.length?": "+data.missing.join(", "):""));return {ok:false};}
  return {ok:true,data};
 }
 async function sendOnboardingInvite(){
  if(!selected||!onboardingLink){setMessage("Generate the onboarding link first.");return;}
  setEmailBusy(true);setMessage("");
  const result=await invokeEmail("onboarding_invite",{link:onboardingLink});
  if(result.ok)setMessage("Onboarding invitation emailed to contractor.");
  setEmailBusy(false);
 }
 async function sendContractorEmail(){
  if(!selected)return;
  if(!emailSubject.trim()||!emailMessage.trim()){setMessage("Enter an email subject and message.");return;}
  setEmailBusy(true);setMessage("");
  const result=await invokeEmail("contractor_message",{subject:emailSubject.trim(),message:emailMessage.trim()});
  if(result.ok){setMessage("Email sent to contractor.");setEmailSubject("");setEmailMessage("");}
  setEmailBusy(false);
 }
 async function generateOnboardingLink(){
  if(!selected)return;
  const email=(editEmail||selected.email||"").trim().toLowerCase();
  if(!email){setMessage("Add and save an email address before generating an onboarding link.");return;}
  setBusy(true);setMessage("");setOnboardingLink("");
  const supabase=createClient();
  if(email!==selected.email?.toLowerCase()){
    const {error:updateEmailError}=await supabase.from("contractors").update({email,updated_at:new Date().toISOString()}).eq("id",selected.id);
    if(updateEmailError){setMessage("Could not save the contractor email address.");setBusy(false);return;}
  }
  let {data:member,error}=await supabase.from("contractor_members").select("id,invite_token").eq("contractor_id",selected.id).eq("email",email).maybeSingle();
  if(error){setMessage("Could not check contractor access.");setBusy(false);return;}
  if(!member){
    const created=await supabase.from("contractor_members").insert({contractor_id:selected.id,email}).select("id,invite_token").single();
    member=created.data;error=created.error;
  }else{
    const refreshed=await supabase.from("contractor_members").update({invite_token:crypto.randomUUID(),invite_expires_at:new Date(Date.now()+30*86400000).toISOString()}).eq("id",member.id).select("id,invite_token").single();
    member=refreshed.data;error=refreshed.error;
  }
  if(error||!member?.invite_token){setMessage("Could not generate contractor access.");setBusy(false);return;}
  const link=`${window.location.origin}/contractor/login?invite=${member.invite_token}&email=${encodeURIComponent(email)}`;
  setOnboardingLink(link);
  try{await navigator.clipboard.writeText(link);setMessage("Onboarding link generated and copied.");}
  catch{setMessage("Onboarding link generated. Copy it below.");}
  setBusy(false);router.refresh();
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
 async function deleteContractor(){
  if(!selected)return;
  if(!confirm(`Delete ${selected.companyName}? This will permanently remove the contractor, onboarding record, invite access, compliance documents and email history. Existing work orders will remain but will no longer be linked to this contractor.`))return;
  setBusy(true);setMessage("");
  const supabase=createClient();
  const paths=selectedDocs.map(d=>d.storagePath).filter(Boolean);
  if(paths.length){
    const {error:storageError}=await supabase.storage.from("contractor-documents").remove(paths);
    if(storageError){setMessage("Contractor files could not be removed. Contractor was not deleted.");setBusy(false);return;}
  }
  const {data,error}=await supabase.from("contractors").delete().eq("id",selected.id).select("id");
  if(error||!data?.length){setMessage(error?.message||"Contractor could not be deleted.");setBusy(false);return;}
  const remaining=contractors.filter(c=>c.id!==selected.id);
  setSelectedId(remaining[0]?.id??null);
  setOnboardingLink("");
  setMessage("Contractor deleted.");
  setBusy(false);router.refresh();
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
  {selected&&<section className="panel contractor-detail"><div className="contractor-detail-head"><div><p className="eyebrow">CONTRACTOR RECORD</p><h2>{selected.companyName}</h2><p>{selected.trade} · {selected.email||"No email"} · {selected.phone||"No phone"}</p></div><div><span className={`contractor-status ${selected.status.toLowerCase()}`}>{selected.status}</span><button className="outline" disabled={busy||!(editEmail||selected.email)} onClick={()=>void generateOnboardingLink()}>Generate onboarding link</button><button className="outline" onClick={()=>void setStatus(selected.status==="Approved"?"Suspended":"Approved")}>{selected.status==="Approved"?"Suspend":"Approve contractor"}</button><button className="danger" disabled={busy} onClick={()=>void deleteContractor()}>Delete contractor</button></div></div>
   {onboardingLink&&<div className="onboarding-link-box"><strong>Contractor onboarding link</strong><input readOnly value={onboardingLink}/><div className="onboarding-link-actions"><button className="outline" onClick={()=>void navigator.clipboard.writeText(onboardingLink)}>Copy link</button><button className="primary" disabled={emailBusy} onClick={()=>void sendOnboardingInvite()}>{emailBusy?"Sending…":"Email invite"}</button></div></div>}<section className="panel contractor-onboarding"><div className="panel-head"><div><p className="eyebrow">UK CONTRACTOR ONBOARDING</p><h2>Compliance onboarding</h2><p>Select every trade the contractor will carry out. The required evidence updates automatically.</p></div><span className={`contractor-status ${onboardingStatus==="Approved"?"approved":onboardingStatus==="Ready for review"?"pending":"pending"}`}>{onboardingStatus}</span></div>
   <div className="trade-check-grid">{trades.map(t=><label key={t} className={`trade-check ${selectedTrades.includes(t)?"selected":""}`}><input type="checkbox" checked={selectedTrades.includes(t)} onChange={()=>void toggleTrade(t)}/><span>{t}</span></label>)}</div>
   <div className="contractor-form-grid onboarding-questions"><label>Number of employees<input type="number" min="0" value={employeeCount} onChange={e=>setEmployeeCount(e.target.value)} placeholder="0"/></label><label className="tick-field"><input type="checkbox" checked={usesSubcontractors} onChange={e=>setUsesSubcontractors(e.target.checked)}/>Uses subcontractors</label><label className="tick-field"><input type="checkbox" checked={transportsWaste} onChange={e=>setTransportsWaste(e.target.checked)}/>Transports waste</label><label className="tick-field"><input type="checkbox" checked={undertakesDesign} onChange={e=>setUndertakesDesign(e.target.checked)}/>Undertakes design / professional advice</label><label className="tick-field"><input type="checkbox" checked={undertakesAsbestos} onChange={e=>setUndertakesAsbestos(e.target.checked)}/>Undertakes licensable asbestos work</label></div>
   <div className="onboarding-checklist"><h3>Required evidence</h3>{requirements.map(req=>{const ok=selectedDocTypes.has(req.type);return <div key={req.type} className={`onboarding-item ${ok?"complete":req.required?"missing":"optional"}`}><div><strong>{ok?"✓":"○"} {req.type}</strong><small>{req.reason}</small></div><span>{ok?"Uploaded":req.required?"Required":"If applicable"}</span></div>})}</div>
   <div className="onboarding-upload"><h3>Upload missing evidence</h3><form onSubmit={uploadDocument}><label>Document type<select value={docType} onChange={e=>setDocType(e.target.value)}>{docTypes.map(x=><option key={x}>{x}</option>)}</select></label><label>Expiry / renewal date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label><label>PDF / image<input required type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><label>Notes<input value={docNotes} onChange={e=>setDocNotes(e.target.value)}/></label><button className="primary" disabled={busy||!file}>Upload evidence</button></form></div>
   <div className="onboarding-declaration"><label>Declaration name<input value={declarationName} onChange={e=>setDeclarationName(e.target.value)} placeholder="Name of person completing onboarding"/></label><label className="tick-field"><input type="checkbox" checked={declarationAccepted} onChange={e=>setDeclarationAccepted(e.target.checked)}/>I confirm the information and documents supplied are current and accurate and that AVIAF will be informed of material changes.</label><div className="onboarding-actions"><button className="primary" disabled={onboardingBusy} onClick={()=>void saveOnboarding()}>Save onboarding</button><button className="outline" disabled={onboardingBusy||!onboardingComplete} onClick={()=>void approveOnboarding()}>Approve onboarding</button></div><p className="onboarding-progress">{completeRequirements.length} of {requiredRequirements.length} required documents uploaded{declarationAccepted&&declarationName.trim()?" · declaration complete":" · declaration outstanding"}</p></div>
  </section>
   <section className="panel contractor-email-panel"><div className="panel-head"><div><p className="eyebrow">EMAIL CONTRACTOR</p><h2>Send email</h2><p>Send a direct message to {selected.email||"this contractor"} from the AVIAF Contractor Portal.</p></div></div><div className="contractor-email-form"><label>Subject<input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} placeholder="Email subject"/></label><label>Message<textarea rows={5} value={emailMessage} onChange={e=>setEmailMessage(e.target.value)} placeholder="Write your message…"/></label><button className="primary" disabled={emailBusy||!selected.email} onClick={()=>void sendContractorEmail()}>{emailBusy?"Sending…":"Send email"}</button></div></section>
   <div className="contractor-detail-grid"><section><h3>Company details</h3><div className="contractor-form-grid"><label>Trade<select value={editTrade} onChange={e=>setEditTrade(e.target.value)}>{trades.map(x=><option key={x}>{x}</option>)}</select></label><label>Email<input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)}/></label><label>Phone<input value={editPhone} onChange={e=>setEditPhone(e.target.value)}/></label></div><button className="primary" type="button" disabled={busy} onClick={()=>void saveContractorDetails()}>Save contractor details</button><dl><div><dt>Contact</dt><dd>{selected.contactName||"—"}</dd></div><div><dt>Registration</dt><dd>{selected.companyRegistration||"—"}</dd></div><div><dt>VAT</dt><dd>{selected.vatNumber||"—"}</dd></div><div><dt>Notes</dt><dd>{selected.notes||"—"}</dd></div></dl></section><section><h3>Upload compliance document</h3><form onSubmit={uploadDocument}><label>Document type<select value={docType} onChange={e=>setDocType(e.target.value)}>{docTypes.map(x=><option key={x}>{x}</option>)}</select></label><label>Expiry date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label><label>PDF / image<input required type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><label>Notes<input value={docNotes} onChange={e=>setDocNotes(e.target.value)}/></label><button className="primary" disabled={busy||!file}>Upload document</button></form></section></div>
   <div className="contractor-documents"><div className="panel-head"><div><p className="eyebrow">COMPLIANCE PACK</p><h2>Documents</h2></div></div>{selectedDocs.length?<div className="block-table-wrap"><table className="block-table"><thead><tr><th>Document</th><th>File</th><th>Expiry</th><th>Status</th><th></th></tr></thead><tbody>{selectedDocs.map(doc=><tr key={doc.id}><td><strong>{doc.documentType}</strong></td><td>{doc.fileName}</td><td>{doc.expiryDate||"No expiry"}</td><td><span className={`doc-status ${expired(doc)?"expired":expiring(doc)?"expiring":"valid"}`}>{expired(doc)?"Expired":expiring(doc)?"Expiring soon":"Current"}</span></td><td><div className="doc-actions"><button onClick={()=>void openDocument(doc)}>Open</button><button onClick={()=>void deleteDocument(doc)}>Delete</button></div></td></tr>)}</tbody></table></div>:<p className="block-empty-inline">No compliance documents uploaded yet.</p>}</div>
  </section>}
  {message&&<p className="unit-message" role="status">{message}</p>}
 </section>
}
