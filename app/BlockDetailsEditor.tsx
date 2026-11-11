"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {Block} from "./types";
export default function BlockDetailsEditor({block}:{block:Block}) {
 const router=useRouter();
 const initial={name:block.name,management_company:block.managementCompany,type:block.type,address:block.address,manager:block.manager,financial_year_end:block.financialYearEnd,units:block.units};
 const [details,setDetails]=useState(initial),[original]=useState(initial),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const labels={name:"Block name",management_company:"Management company",type:"Property type",address:"Full address",manager:"Portfolio manager",financial_year_end:"Financial year end",units:"Number of units"};
 return <section className="panel block-onboard-panel"><h2>Edit block details</h2><p>Increasing the count does not create or replace units. Add named units below. Existing residents and payment references are preserved. Counts cannot be reduced here.</p><form className="block-onboard-form" onSubmit={async event=>{
 event.preventDefault();setBusy(true);setMessage("");try{
 const response=await fetch(`/api/blocks/${block.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({details,original})});
 const result=await response.json();if(!response.ok)throw new Error(result.error||"Save failed.");
 setMessage("Block details saved.");router.refresh();
 }catch(error){setMessage(error instanceof Error?error.message:"Save failed.");}finally{setBusy(false);}
 }}><fieldset disabled={busy} className="block-onboard-grid">{(Object.keys(labels) as (keyof typeof labels)[]).map(field=><label key={field}>{labels[field]}<input required maxLength={field==="address"?2000:200} type={field==="units"?"number":field==="financial_year_end"?"date":"text"} min={field==="units"?block.units:undefined} step={field==="units"?1:undefined} value={details[field]} onChange={e=>setDetails({...details,[field]:field==="units"?Number(e.target.value):e.target.value})}/></label>)}</fieldset><button className="primary" disabled={busy}>{busy?"Saving…":"Save block details"}</button><p role="status">{message}</p>{message&&<button type="button" disabled={busy} onClick={()=>window.location.reload()}>Reload current block details</button>}</form></section>;
}
