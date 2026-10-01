"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/browser";
import type {TenantRequest} from "./tenant/TenantPortal";
import type {Block,Unit,Resident} from "./types";
export default function TenantRequestRegister({requests,blocks,units,residents}:{requests:TenantRequest[];blocks:Block[];units:Unit[];residents:Resident[]}){
 return <section className="panel tenant-card"><p className="eyebrow">TENANT PORTAL</p><h2>Tenant maintenance requests</h2>{requests.length?<div className="tenant-request-list">{requests.map(request=><RequestRow key={request.id} request={request} location={`${blocks.find(b=>b.id===request.block_id)?.name??"Building"} · ${units.find(u=>u.id===request.unit_id)?.unitNumber??"Unit"}`} name={residents.find(r=>r.id===request.resident_id)?.fullName??"Resident"}/>)}</div>:<p>No maintenance requests have been submitted by tenants yet.</p>}</section>;
}
function RequestRow({request,location,name}:{request:TenantRequest;location:string;name:string}){
 const router=useRouter();const [status,setStatus]=useState(request.status),[reply,setReply]=useState(request.manager_reply),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage("");try{const {data,error}=await createClient().from("tenant_requests").update({status,manager_reply:reply.trim(),updated_at:new Date().toISOString()}).eq("id",request.id).select("id");if(error||!data?.length)throw error;setMessage("Update saved and visible to the tenant.");router.refresh();}catch{setMessage("Update could not be saved.");}finally{setBusy(false);}}
 return <article><h3>#{request.id} · {request.title}</h3><p>{location} · {name} · {request.priority}</p><p>{request.description}</p><form className="tenant-form" onSubmit={save}><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}>{["Reported","In progress","On hold","Complete"].map(v=><option key={v}>{v}</option>)}</select></label><label>Update for tenant<textarea maxLength={5000} rows={3} value={reply} onChange={e=>setReply(e.target.value)}/></label><button className="primary" disabled={busy}>{busy?"Saving…":"Save tenant update"}</button>{message&&<p role="status">{message}</p>}</form></article>;
}
