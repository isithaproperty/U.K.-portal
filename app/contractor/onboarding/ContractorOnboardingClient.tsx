"use client";
import {useMemo,useState} from "react";
import {createClient} from "../../../lib/supabase/browser";

const trades=["General","Plumbing","Electrical","Gas","Lift","Fire safety","Cleaning","Security","Grounds","Fabric","Mechanical","Asbestos","Other"];
const docTypes=["Public Liability Insurance","Employers Liability Insurance","Health & Safety Policy","Competence / Qualifications","RAMS / Method Statement","Gas Safe Registration","Electrical Competence / Scheme Evidence","Fire Safety Competence / Certification","Lift Engineer Competence","SIA Licence Evidence","Waste Carrier Registration","HSE Asbestos Licence","Asbestos Training","Professional Indemnity Insurance","Grounds / Plant / Pesticide Competence","Accreditation / Licence","DBS / Site Access","Other"];

type Contractor={id:number;company_name:string;email:string|null;phone:string|null;status:string};
type Onboarding={employee_count:number|null;transports_waste:boolean;undertakes_design:boolean;undertakes_asbestos:boolean;uses_subcontractors:boolean;onboarding_status:string;declaration_name:string|null;declaration_accepted_at:string|null;review_notes:string;reviewed_at:string|null}|null;
type Doc={id:number;document_type:string;file_name:string;storage_path:string;expiry_date:string|null;notes:string;uploaded_at:string;uploaded_by:string};

export default function ContractorOnboardingClient({contractor,initialTrades,onboarding,documents,viewerEmail}:{contractor:Contractor;initialTrades:string[];onboarding:Onboarding;documents:Doc[];viewerEmail:string}){
 const[chosenTrades,setChosenTrades]=useState(initialTrades),[employeeCount,setEmployeeCount]=useState(onboarding?.employee_count==null?"":String(onboarding.employee_count));
 const[transportsWaste,setTransportsWaste]=useState(Boolean(onboarding?.transports_waste)),[undertakesDesign,setUndertakesDesign]=useState(Boolean(onboarding?.undertakes_design)),[undertakesAsbestos,setUndertakesAsbestos]=useState(Boolean(onboarding?.undertakes_asbestos)),[usesSubcontractors,setUsesSubcontractors]=useState(Boolean(onboarding?.uses_subcontractors));
 const[status,setStatus]=useState(onboarding?.onboarding_status||"Incomplete"),[declarationName,setDeclarationName]=useState(onboarding?.declaration_name||""),[declarationAccepted,setDeclarationAccepted]=useState(Boolean(onboarding?.declaration_accepted_at));
 const[docs,setDocs]=useState(documents),[docType,setDocType]=useState("Public Liability Insurance"),[expiry,setExpiry]=useState(""),[notes,setNotes]=useState(""),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const locked=status==="Approved"||status==="Rejected";
 const employeeNumber=employeeCount===""?null:Number(employeeCount);
 const docSet=new Set(docs.map(d=>d.document_type));
 const requirements=useMemo(()=>{
  const r:{type:string;reason:string;required:boolean}[]=[
   {type:"Public Liability Insurance",reason:"Required by AVIAF before appointment.",required:true},
   {type:"Competence / Qualifications",reason:"Evidence of appropriate competence for the work.",required:true},
   {type:"RAMS / Method Statement",reason:"Sample method statement / RAMS. Job-specific RAMS may still be required.",required:true},
   {type:"Health & Safety Policy",reason:employeeNumber!==null&&employeeNumber>=5?"Written policy required for employers with 5+ employees.":"H&S policy / arrangements evidence.",required:true},
   {type:"Employers Liability Insurance",reason:"Required where the business employs staff, subject to statutory exemptions.",required:employeeNumber!==null&&employeeNumber>0},
  ];
  if(chosenTrades.includes("Gas"))r.push({type:"Gas Safe Registration",reason:"Required for gas work.",required:true});
  if(chosenTrades.includes("Electrical"))r.push({type:"Electrical Competence / Scheme Evidence",reason:"Electrical competence / scheme evidence.",required:true});
  if(chosenTrades.includes("Fire safety"))r.push({type:"Fire Safety Competence / Certification",reason:"Evidence appropriate to the fire-safety service.",required:true});
  if(chosenTrades.includes("Lift"))r.push({type:"Lift Engineer Competence",reason:"Lift engineering competence evidence.",required:true});
  if(chosenTrades.includes("Security"))r.push({type:"SIA Licence Evidence",reason:"Required where the security activity is licensable.",required:true});
  if(chosenTrades.includes("Asbestos")||undertakesAsbestos){r.push({type:"Asbestos Training",reason:"Training appropriate to the asbestos work.",required:true});r.push({type:"HSE Asbestos Licence",reason:"Required where the work is licensable.",required:undertakesAsbestos});}
  if(chosenTrades.includes("Grounds"))r.push({type:"Grounds / Plant / Pesticide Competence",reason:"Relevant grounds / plant / pesticide competence.",required:true});
  if(transportsWaste)r.push({type:"Waste Carrier Registration",reason:"Required where waste-carrier registration applies.",required:true});
  if(undertakesDesign)r.push({type:"Professional Indemnity Insurance",reason:"AVIAF requirement for design / professional advice.",required:true});
  return r;
 },[chosenTrades,employeeNumber,transportsWaste,undertakesDesign,undertakesAsbestos]);
 const required=requirements.filter(r=>r.required),complete=required.filter(r=>docSet.has(r.type));
 const ready=chosenTrades.length>0&&complete.length===required.length&&declarationAccepted&&Boolean(declarationName.trim());

 async function toggleTrade(t:string){
  if(locked)return;
  const supabase=createClient();
  if(chosenTrades.includes(t)){const next=chosenTrades.filter(x=>x!==t);setChosenTrades(next);await supabase.from("contractor_trades").delete().eq("contractor_id",contractor.id).eq("trade",t);}
  else{setChosenTrades([...chosenTrades,t]);await supabase.from("contractor_trades").upsert({contractor_id:contractor.id,trade:t},{onConflict:"contractor_id,trade"});}
 }
 async function notify(eventType:string,extra:Record<string,unknown>={}){
  const supabase=createClient();
  await supabase.functions.invoke("contractor-email",{body:{contractorId:contractor.id,eventType,...extra}});
 }
 async function save(){
  if(locked)return;setBusy(true);setMessage("");
  const {error}=await createClient().from("contractor_onboarding").upsert({contractor_id:contractor.id,employee_count:employeeCount===""?null:Number(employeeCount),transports_waste:transportsWaste,undertakes_design:undertakesDesign,undertakes_asbestos:undertakesAsbestos,uses_subcontractors:usesSubcontractors,onboarding_status:ready?"Ready for review":"Incomplete",declaration_name:declarationName.trim()||null,declaration_accepted_at:declarationAccepted?new Date().toISOString():null,updated_at:new Date().toISOString()},{onConflict:"contractor_id"});
  if(error)setMessage("Could not save onboarding. Please try again.");else{const wasReady=status==="Ready for review";setStatus(ready?"Ready for review":"Incomplete");setMessage(ready?"Your onboarding pack has been submitted for review.":"Saved. Outstanding items are shown below.");if(ready&&!wasReady)await notify("onboarding_submitted");}
  setBusy(false);
 }
 async function upload(e:React.FormEvent){
  e.preventDefault();if(!file||locked)return;setBusy(true);setMessage("");
  const supabase=createClient();const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-");const path=`${contractor.id}/${crypto.randomUUID()}-${safe}`;
  const {error:up}=await supabase.storage.from("contractor-documents").upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(up){setMessage("Upload failed.");setBusy(false);return;}
  const {data,error}=await supabase.from("contractor_documents").insert({contractor_id:contractor.id,document_type:docType,file_name:file.name,storage_path:path,mime_type:file.type||null,file_size:file.size,expiry_date:expiry||null,notes:notes.trim(),uploaded_by:viewerEmail}).select("id,document_type,file_name,storage_path,expiry_date,notes,uploaded_at,uploaded_by").single();
  if(error){setMessage("Your file was uploaded, but its document record could not be saved. Contact AVIAF before uploading it again.");}
  else{setDocs(current=>[data,...current]);setFile(null);setExpiry("");setNotes("");setMessage("Evidence uploaded.");await notify("document_uploaded",{documentType:docType});}
  setBusy(false);
 }
 async function signOut(){await createClient().auth.signOut();window.location.href="/contractor/login";}

 return <main className="contractor-self-page"><div className="contractor-self-shell">
  <header className="contractor-self-head"><div><p className="eyebrow">AVIAF CONTRACTOR PORTAL</p><h1>{contractor.company_name}</h1><p>Complete your onboarding pack and upload the evidence required for the work you undertake.</p></div><div><span className={`contractor-status ${status==="Approved"?"approved":"pending"}`}>{status}</span><button className="outline" onClick={()=>void signOut()}>Sign out</button></div></header>
  {locked&&<div className="onboarding-lock"><strong>{status}</strong><span>{status==="Approved"?"Your onboarding has been approved. Contact AVIAF if anything changes.":"AVIAF has completed its review. Contact AVIAF for next steps."}</span></div>}
  <section className="panel"><h2>1. Select your trades</h2><div className="trade-check-grid">{trades.map(t=><label key={t} className={`trade-check ${chosenTrades.includes(t)?"selected":""}`}><input disabled={locked} type="checkbox" checked={chosenTrades.includes(t)} onChange={()=>void toggleTrade(t)}/><span>{t}</span></label>)}</div></section>
  <section className="panel"><h2>2. Business questions</h2><div className="contractor-form-grid onboarding-questions"><label>Number of employees<input disabled={locked} type="number" min="0" value={employeeCount} onChange={e=>setEmployeeCount(e.target.value)}/></label><label className="tick-field"><input disabled={locked} type="checkbox" checked={usesSubcontractors} onChange={e=>setUsesSubcontractors(e.target.checked)}/>Uses subcontractors</label><label className="tick-field"><input disabled={locked} type="checkbox" checked={transportsWaste} onChange={e=>setTransportsWaste(e.target.checked)}/>Transports waste</label><label className="tick-field"><input disabled={locked} type="checkbox" checked={undertakesDesign} onChange={e=>setUndertakesDesign(e.target.checked)}/>Design / professional advice</label><label className="tick-field"><input disabled={locked} type="checkbox" checked={undertakesAsbestos} onChange={e=>setUndertakesAsbestos(e.target.checked)}/>Licensable asbestos work</label></div></section>
  <section className="panel"><h2>3. Required evidence</h2><div className="onboarding-checklist">{requirements.map(r=>{const ok=docSet.has(r.type);return <div key={r.type} className={`onboarding-item ${ok?"complete":r.required?"missing":"optional"}`}><div><strong>{ok?"✓":"○"} {r.type}</strong><small>{r.reason}</small></div><span>{ok?"Uploaded":r.required?"Required":"If applicable"}</span></div>})}</div>
  {!locked&&<form className="contractor-self-upload" onSubmit={upload}><label>Document type<select value={docType} onChange={e=>setDocType(e.target.value)}>{docTypes.map(x=><option key={x}>{x}</option>)}</select></label><label>Expiry / renewal date<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label><label>File<input required type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><label>Notes<input value={notes} onChange={e=>setNotes(e.target.value)}/></label><button className="primary" disabled={busy||!file}>Upload evidence</button></form>}
  {docs.length>0&&<div className="contractor-self-docs">{docs.map(d=><div key={d.id}><div><b>{d.document_type}</b><span>{d.file_name}{d.expiry_date?` · expires ${d.expiry_date}`:""}</span></div></div>)}</div>}</section>
  <section className="panel"><h2>4. Declaration & submit</h2><label>Declaration name<input disabled={locked} value={declarationName} onChange={e=>setDeclarationName(e.target.value)} placeholder="Full name"/></label><label className="tick-field declaration-check"><input disabled={locked} type="checkbox" checked={declarationAccepted} onChange={e=>setDeclarationAccepted(e.target.checked)}/>I confirm the information and documents supplied are current and accurate, and I will notify AVIAF of material changes.</label>
  {!locked&&<button className="primary" disabled={busy} onClick={()=>void save()}>{ready?"Submit for review":"Save progress"}</button>}<p className="onboarding-progress">{complete.length} of {required.length} required documents uploaded{declarationAccepted&&declarationName.trim()?" · declaration complete":" · declaration outstanding"}</p></section>
  {message&&<p className="unit-message" role="status">{message}</p>}
 </div></main>;
}