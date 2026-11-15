"use client";
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Resident} from './types';
type Saved={id:number;full_name:string;email:string;contact_email:string|null;contact_version:number;phone:string|null;archived_at:string|null};
type History={id:string;version:number;actor_email:string|null;actor_role:string;occurred_at:string;before_snapshot:Saved;after_snapshot:Saved};
export default function ResidentContactEditor({resident}:{resident:Resident}){
 const router=useRouter(),busy=useRef(false);
 const [open,setOpen]=useState(false),[saved,setSaved]=useState<Saved|null>(null),[history,setHistory]=useState<History[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState('');
 const url=`/api/blocks/${resident.blockId}/residents/${resident.id}`;
 async function load(older=false){if(busy.current)return;busy.current=true;setLoading(true);setMessage('');if(!older){setSaved(null);setBlocked(true);}try{
  const response=await fetch(url+(older?`?beforeVersion=${history.at(-1)?.version}`:''),{cache:'no-store'});const body=await response.json();if(!response.ok||!body.resident||!Array.isArray(body.history))throw Error(body.error||'Saved details and audit history could not be loaded.');
  setHistory(previous=>older?[...previous,...body.history]:body.history);setMore(body.historyCount>body.history.length);
  if(!older){const row=body.resident as Saved;setSaved(row);setName(row.full_name);setEmail(row.contact_email??row.email);setPhone(row.phone??'');setBlocked(false);}
 }catch(error){setMessage(error instanceof Error?error.message:'Details could not be verified.');}finally{busy.current=false;setLoading(false);}}
 async function save(event:React.FormEvent){event.preventDefault();if(!saved||busy.current||blocked)return;busy.current=true;setLoading(true);setMessage('');try{
  const response=await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:saved.contact_version,fullName:name,contactEmail:email,phone:phone||null})});const body=await response.json();
  if(!response.ok){if(response.status===409||body.uncertain!==false)setBlocked(true);throw Error(body.error||'Save was not confirmed. Reload before retrying.');}
  if(!body.resident?.id)throw Error('Save was not confirmed. Reload before retrying.');
  setBlocked(true);setMessage('Saved. Reload details to review the audit entry.');router.refresh();
 }catch(error){setBlocked(true);setMessage(error instanceof Error?error.message:'Save was not confirmed. Reload details and audit history before retrying.');}finally{busy.current=false;setLoading(false);}}
 if(resident.archivedAt)return null;
 return <><button type="button" onClick={()=>{setOpen(true);void load();}}>Edit contact details</button>{open&&<section className="panel" aria-label={`Contact details for ${resident.fullName}`}><h3>Edit resident contact details</h3><p>Contact email is separate from portal sign-in and access. Financial delivery contacts and consent are managed separately.</p><button type="button" disabled={loading} onClick={()=>void load()}>Reload saved details</button><button type="button" disabled={loading} onClick={()=>setOpen(false)}>Close</button>{message&&<p role="status">{message}</p>}{saved&&<form onSubmit={save}><fieldset disabled={loading||blocked||Boolean(saved.archived_at)}><label>Name<input required maxLength={200} value={name} onChange={event=>setName(event.target.value)}/></label><label>Contact email<input required type="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label><label>Phone<input maxLength={80} value={phone} onChange={event=>setPhone(event.target.value)}/></label><p>Portal sign-in email (unchanged): <strong>{saved.email}</strong></p><button type="submit">Save contact details</button></fieldset><h4>Change history</h4>{history.length===0?<p>No changes recorded since contact auditing was activated.</p>:history.map(entry=><article key={entry.id}><p>Version {entry.version} · {entry.occurred_at} · {entry.actor_email??entry.actor_role}</p><p>Name: {entry.before_snapshot.full_name} → {entry.after_snapshot.full_name}</p><p>Contact email: {entry.before_snapshot.contact_email??entry.before_snapshot.email} → {entry.after_snapshot.contact_email??entry.after_snapshot.email}</p><p>Phone: {entry.before_snapshot.phone??'—'} → {entry.after_snapshot.phone??'—'}</p></article>)}{more&&<button type="button" disabled={loading} onClick={()=>void load(true)}>Load older changes</button>}</form>}</section>}</>;
}
