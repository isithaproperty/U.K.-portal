"use client";
import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "../lib/supabase/browser";
import type {Block,WorkOrder} from "./types";

type Filter="open"|"complete"|"approved"|"all";

export default function WorkOrderRegister({
  blocks,workOrders,viewerEmail,memberRole,portfolioManager,onOpenBlock
}:{
  blocks:Block[];
  workOrders:WorkOrder[];
  viewerEmail:string;
  memberRole:string|null;
  portfolioManager:string|null;
  onOpenBlock:(id:number)=>void;
}){
 const router=useRouter();
 const[filter,setFilter]=useState<Filter>("open");
 const[message,setMessage]=useState("");
 const blockById=useMemo(()=>new Map(blocks.map(b=>[b.id,b])),[blocks]);
 const visible=useMemo(()=>workOrders.filter(wo=>{
   if(filter==="open") return wo.status!=="Complete";
   if(filter==="complete") return wo.status==="Complete"&&wo.paymentStatus!=="Approved"&&wo.paymentStatus!=="Paid";
   if(filter==="approved") return wo.paymentStatus==="Approved"||wo.paymentStatus==="Paid";
   return true;
 }),[workOrders,filter]);
 const openCount=workOrders.filter(wo=>wo.status!=="Complete").length;
 const completeCount=workOrders.filter(wo=>wo.status==="Complete"&&wo.paymentStatus!=="Approved"&&wo.paymentStatus!=="Paid").length;
 const approvedCount=workOrders.filter(wo=>wo.paymentStatus==="Approved"||wo.paymentStatus==="Paid").length;

 async function updateWO(id:number,patch:Record<string,unknown>){
   setMessage("");
   const supabase=createClient();
   const {error}=await supabase.from("work_orders").update({...patch,updated_at:new Date().toISOString()}).eq("id",id);
   if(error){setMessage("Work order could not be updated: "+error.message);return;}
   router.refresh();
 }
 async function approvePayment(wo:WorkOrder){
   if(wo.status!=="Complete"){setMessage("Complete the work order before approving payment.");return;}
   if(wo.actualCost===null){setMessage("Enter the actual cost before approving payment.");return;}
   await updateWO(wo.id,{
     payment_status:"Approved",
     payment_approved_by:viewerEmail,
     payment_approved_at:new Date().toISOString()
   });
 }
 async function markPaid(wo:WorkOrder){
   await updateWO(wo.id,{payment_status:"Paid",paid_at:new Date().toISOString()});
 }

 const title=memberRole==="owner"?"All portfolio work orders":portfolioManager?portfolioManager+" portfolio work orders":"Work orders";

 return <section className="portfolio-wo-page">
   <div className="page-head"><div><p className="eyebrow">WORK ORDERS</p><h1>{title}</h1><p>{memberRole==="owner"?"All active work orders across the portfolio.":"Only work orders for blocks allocated to your portfolio are shown."}</p></div></div>
   <section className="stat-grid three">
    <article className="stat amber"><div><span>Open</span><strong>{openCount}</strong><small>Live portfolio jobs</small></div><i>⌁</i></article>
    <article className="stat blue"><div><span>Awaiting payment approval</span><strong>{completeCount}</strong><small>Completed work orders</small></div><i>£</i></article>
    <article className="stat green"><div><span>Approved / paid</span><strong>{approvedCount}</strong><small>Payment processed or approved</small></div><i>✓</i></article>
   </section>
   <div className="wo-register-tabs">
    <button className={filter==="open"?"active":""} onClick={()=>setFilter("open")}>Open ({openCount})</button>
    <button className={filter==="complete"?"active":""} onClick={()=>setFilter("complete")}>Awaiting payment ({completeCount})</button>
    <button className={filter==="approved"?"active":""} onClick={()=>setFilter("approved")}>Approved / paid ({approvedCount})</button>
    <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>All ({workOrders.length})</button>
   </div>
   <section className="panel portfolio-wo-register">
    {visible.length?<div className="block-table-wrap"><table className="block-table"><thead><tr><th>WO</th><th>Property</th><th>Job</th><th>Contractor</th><th>Priority</th><th>Status</th><th>Actual cost</th><th>Payment</th><th></th></tr></thead><tbody>
     {visible.map(wo=>{const block=blockById.get(wo.blockId);return <tr key={wo.id}>
      <td><strong>{wo.workOrderNumber}</strong></td>
      <td><strong>{block?.name??"Unknown block"}</strong><small className="wo-property-sub">{block?.manager??""}</small></td>
      <td><strong>{wo.title}</strong><small className="wo-property-sub">{wo.category}</small></td>
      <td>{wo.contractor||"Not assigned"}</td>
      <td><span className={"priority-pill "+wo.priority.toLowerCase()}>{wo.priority}</span></td>
      <td><select value={wo.status} onChange={e=>void updateWO(wo.id,{status:e.target.value})}><option>Open</option><option>In progress</option><option>On hold</option><option>Complete</option></select></td>
      <td><input className="wo-cost-input" type="number" min="0" step="0.01" defaultValue={wo.actualCost??""} onBlur={e=>{const v=e.currentTarget.value;void updateWO(wo.id,{actual_cost:v?Number(v):null})}}/></td>
      <td>{wo.paymentStatus==="Approved"?<span className="doc-status valid">Approved</span>:wo.paymentStatus==="Paid"?<span className="doc-status valid">Paid</span>:wo.status==="Complete"?<button className="wo-pay-btn" disabled={wo.actualCost===null} onClick={()=>void approvePayment(wo)}>Approve payment</button>:<span className="doc-status expiring">Not ready</span>}</td>
      <td><div className="wo-row-actions"><button onClick={()=>wo.blockId&&onOpenBlock(wo.blockId)}>Open property</button>{memberRole==="owner"&&wo.paymentStatus==="Approved"&&<button onClick={()=>void markPaid(wo)}>Mark paid</button>}</div></td>
     </tr>})}
    </tbody></table></div>:<p className="block-empty-inline">No work orders in this view.</p>}
   </section>
   {message&&<p className="unit-message" role="status">{message}</p>}
 </section>
}
