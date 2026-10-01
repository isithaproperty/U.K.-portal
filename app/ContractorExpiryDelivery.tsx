'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '../lib/supabase/browser';
export default function ContractorExpiryDelivery({contractorId}:{contractorId:number}){
 const router=useRouter();
 const [notices,setNotices]=useState<{recipient:string;status:string;last_error:string|null}[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setNotices([]);setMessage('');void createClient().from('contractor_expiry_notices').select('recipient,status,last_error').eq('contractor_id',contractorId).neq('status','Cancelled').order('created_at',{ascending:false}).limit(20).then(({data,error})=>{if(active){setNotices(data??[]);if(error)setMessage('Renewal email status unavailable.');}});return()=>{active=false}},[contractorId,busy]);
 async function check(){setBusy(true);setMessage('');try{const {data,error}=await createClient().functions.invoke('contractor-expiry',{body:{}});if(error){let detail='Expiry email service unavailable.';try{detail=(await error.context?.json())?.error||detail;}catch{}setMessage(detail);}else setMessage(data.failed?'Contractors checked; some emails are queued for retry.':'Contractors checked and pending emails processed.');}finally{setBusy(false);router.refresh();}}
 return <section><h3>Renewal notifications</h3>{notices.length?notices.map((n,i)=><p key={`${n.recipient}-${i}`}>{n.recipient} · {n.status}{n.last_error?` · ${n.last_error}`:''}</p>):<p>No renewal notifications queued for this contractor.</p>}<button className="outline" disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check expiry & send queued notices'}</button>{message&&<p role="status">{message}</p>}</section>;
}
