'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '../lib/supabase/browser';
import {poundsToPence} from '../lib/creditors';
import type {WorkOrder} from './types';

/** Financial approval stays separate from document uploads and actual bank settlements. */
export default function WorkOrderCostApproval({order,hasSettlements,disabled=false}:{order:WorkOrder;hasSettlements:boolean;disabled?:boolean}){
 const router=useRouter(),lock=useRef(false);
 const [amount,setAmount]=useState(order.actualCost===null?'':order.actualCost.toFixed(2)),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const ready=!!order.contractorId&&(order.isOngoing?['Open','In progress','On hold'].includes(order.status):order.status==='Complete');
 const immutable=hasSettlements||order.paymentStatus==='Paid';
 async function approve(event:React.FormEvent){
  event.preventDefault();if(lock.current||disabled||immutable||!ready)return;
  lock.current=true;setBusy(true);setMessage('');
  try{
   const actualCost=poundsToPence(amount)/100,client=createClient();
   const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user?.email)throw new Error('Sign in again before approving.');
   const now=new Date().toISOString();
   const {data,error}=await client.from('work_orders').update({actual_cost:actualCost,payment_status:'Approved',payment_approved_by:user.email.toLowerCase(),payment_approved_at:now,updated_at:now}).eq('id',order.id).eq('block_id',order.blockId).eq('updated_at',order.updatedAt).select('id').single();
   if(error||!data)throw new Error('Approval was not confirmed. Reload the work order before trying again.');
   setMessage('Cost approved. No invoice or bank payment was created.');router.refresh();
  }catch(error){setMessage(error instanceof Error?error.message:'Approval was not confirmed. Reload before trying again.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="panel tenant-card tenant-form"><h2>Work-order cost approval</h2><p>{order.workOrderNumber} · {order.title}. {order.isOngoing?'Approve the total contract cost once; record each monthly invoice separately. The contract stays open.':'Complete the job before approving its cost.'} Approval does not mean paid.</p>
 <form onSubmit={approve}><label>{order.isOngoing?'Approved contract cost (£)':'Approved job cost (£)'}<input required type="number" min="0.01" step="0.01" value={amount} disabled={busy||disabled||immutable||!ready} onChange={event=>setAmount(event.target.value)}/></label><button className="primary" disabled={busy||disabled||immutable||!ready}>{busy?'Saving…':'Approve cost for payment'}</button></form>
 {immutable&&<p>Costs with recorded settlements are protected. Corrections require a separate financial review.</p>}{!ready&&!immutable&&<p>Assign a contractor and {order.isOngoing?'keep this contract active':'complete this work order'} before approval.</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
