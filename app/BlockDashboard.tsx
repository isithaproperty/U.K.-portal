"use client";
import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "../lib/supabase/browser";
import type {Block,Unit,Resident,WorkOrder} from "./types";

type Tab="overview"|"workorders"|"residents"|"charges"|"safety";
const safetyAreas=["Building registration","Safety case","Fire safety","Structural safety","Plans & drawings","Maintenance & inspections","Changes & refurbishments","Mandatory occurrences","Incidents & emergencies","Resident engagement","Complaints & concerns","Audit & assurance"];

export default function BlockDashboard({block,units,residents,workOrders,onBack}:{block:Block;units:Unit[];residents:Resident[];workOrders:WorkOrder[];onBack:()=>void}){
 const router=useRouter();
 const[tab,setTab]=useState<Tab>("overview");
 const[title,setTitle]=useState(""),[description,setDescription]=useState(""),[priority,setPriority]=useState("Normal"),[saving,setSaving]=useState(false),[message,setMessage]=useState("");
 const blockUnits=useMemo(()=>units.filter(u=>u.blockId===block.id),[units,block.id]);
 const blockResidents=useMemo(()=>residents.filter(r=>r.blockId===block.id),[residents,block.id]);
 const blockWOs=useMemo(()=>workOrders.filter(w=>w.blockId===block.id),[workOrders,block.id]);
 const unitById=new Map(blockUnits.map(u=>[u.id,u]));
 async function raiseWorkOrder(e:React.FormEvent){
  e.preventDefault(); setSaving(true); setMessage("");
  const supabase=createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user?.email){setMessage("Please sign in again.");setSaving(false);return;}
  const {error}=await supabase.from("work_orders").insert({
    block_id:block.id,title:title.trim(),description:description.trim(),priority,status:"Open",
    address_snapshot:block.address,created_by:user.email.toLowerCase()
  });
  if(error){setMessage("Work order could not be saved.");setSaving(false);return;}
  setTitle("");setDescription("");setPriority("Normal");setMessage("Work order raised for "+block.name+".");setSaving(false);router.refresh();
 }
 return <section className="block-dashboard">
  <button className="block-back" onClick={onBack}>← Back to blocks</button>
  <div className="block-dashboard-hero"><div><p className="eyebrow">BLOCK DASHBOARD</p><h1>{block.name}</h1><p>{block.address.replace(/\n/g,", ")}</p></div><div><span>{block.units} units</span><small>{block.managementCompany}</small></div></div>
  <nav className="block-tabs">{([["overview","Overview"],["workorders","Work orders"],["residents","Residents"],["charges","Levies / service charges"],["safety","Building safety"]] as [Tab,string][]).map(([key,label])=><button key={key} className={tab===key?"active":""} onClick={()=>setTab(key)}>{label}</button>)}</nav>
  {tab==="overview"&&<><section className="stat-grid"><article className="stat blue"><div><span>Residents</span><strong>{blockResidents.length}</strong><small>Assigned to this block</small></div><i>◎</i></article><article className="stat green"><div><span>Units entered</span><strong>{blockUnits.length}</strong><small>Live unit register</small></div><i>▦</i></article><article className="stat amber"><div><span>Open work orders</span><strong>{blockWOs.filter(w=>w.status!=="Complete"&&w.status!=="Cancelled").length}</strong><small>For this block</small></div><i>⌁</i></article><article className="stat blue"><div><span>Safety records</span><strong>0</strong><small>No records added yet</small></div><i>◇</i></article></section><div className="block-dashboard-grid"><section className="panel block-summary-card"><p className="eyebrow">BLOCK DETAILS</p><h2>{block.name}</h2><dl><div><dt>Address</dt><dd>{block.address}</dd></div><div><dt>Manager</dt><dd>{block.manager}</dd></div><div><dt>Type</dt><dd>{block.type}</dd></div><div><dt>Financial year end</dt><dd>{block.financialYearEnd}</dd></div></dl></section><section className="panel block-action-card"><p className="eyebrow">QUICK ACTIONS</p><h2>Manage this block</h2><button onClick={()=>setTab("workorders")}>Raise work order</button><button onClick={()=>setTab("residents")}>View residents</button><button onClick={()=>setTab("charges")}>View service charges</button><button onClick={()=>setTab("safety")}>Open building safety</button></section></div></>}
  {tab==="workorders"&&<><div className="page-head"><div><p className="eyebrow">WORK ORDERS</p><h1>{block.name}</h1><p>New work orders automatically use this block and address.</p></div></div><div className="block-dashboard-grid"><section className="panel block-wo-form"><p className="eyebrow">RAISE WORK ORDER</p><h2>New work order</h2><div className="locked-field"><span>Block</span><b>{block.name}</b></div><div className="locked-field"><span>Address</span><b>{block.address.replace(/\n/g,", ")}</b></div><form onSubmit={raiseWorkOrder}><label>Title<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Water leak in communal hallway"/></label><label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={5}/></label><label>Priority<select value={priority} onChange={e=>setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label><button className="primary" disabled={saving||!title.trim()}>{saving?"Saving…":"Raise work order"}</button>{message&&<p className="unit-message">{message}</p>}</form></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">THIS BLOCK</p><h2>Work order register</h2></div></div>{blockWOs.length?<div className="wo-list">{blockWOs.map(wo=><article key={wo.id}><div><b>{wo.title}</b><span>{wo.addressSnapshot.replace(/\n/g,", ")}</span></div><div><em>{wo.priority}</em><strong>{wo.status}</strong></div></article>)}</div>:<p className="block-empty-inline">No work orders have been raised for this block.</p>}</section></div></>}
  {tab==="residents"&&<><div className="page-head"><div><p className="eyebrow">RESIDENTS</p><h1>{block.name}</h1><p>{blockResidents.length} resident record{blockResidents.length===1?"":"s"} linked to this block.</p></div></div><section className="panel">{blockUnits.length?<div className="block-table-wrap"><table className="block-table"><thead><tr><th>Unit</th><th>Resident</th><th>Email</th><th>Phone</th></tr></thead><tbody>{blockUnits.flatMap(unit=>{const people=blockResidents.filter(r=>r.unitId===unit.id);return people.length?people.map(person=><tr key={person.id}><td><strong>{unit.unitNumber}</strong></td><td>{person.fullName}</td><td>{person.email}</td><td>{person.phone??"—"}</td></tr>):[<tr key={`u-${unit.id}`}><td><strong>{unit.unitNumber}</strong></td><td>Unassigned</td><td>—</td><td>—</td></tr>]})}</tbody></table></div>:<p className="block-empty-inline">No units or residents have been added to this block.</p>}</section></>}
  {tab==="charges"&&<><div className="page-head"><div><p className="eyebrow">LEVIES / SERVICE CHARGES</p><h1>{block.name}</h1><p>Financial records for this block will appear here.</p></div></div><div className="feature-panel"><span>£</span><h2>No service charge data yet</h2><p>This module is scoped to {block.name}. When service charge or levy data is loaded, balances and arrears will only show for this block.</p></div></>}
  {tab==="safety"&&<><div className="page-head"><div><p className="eyebrow">BUILDING SAFETY</p><h1>{block.name}</h1><p>{block.address.replace(/\n/g,", ")}</p></div></div><div className="clean-notice">No building-safety records have been added for this block yet.</div><div className="safety-empty-grid">{safetyAreas.map(area=><article className="panel" key={area}><span>▰</span><h2>{area}</h2><p>No records added</p></article>)}</div></>}
 </section>
}
