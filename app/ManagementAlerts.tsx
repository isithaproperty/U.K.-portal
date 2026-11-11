"use client";
import {useEffect,useState} from "react";
export default function ManagementAlerts(){
 const [alerts,setAlerts]=useState<{block_id:number;consultation_id:string;review_date:string;snapshot:{title:string}}[]>([]);
 useEffect(()=>{const controller=new AbortController();void fetch("/api/management-alerts",{signal:controller.signal,cache:"no-store"}).then(async r=>{if(r.ok){const data=await r.json();if(!controller.signal.aborted)setAlerts(data.alerts??[]);}}).catch(()=>{});return()=>controller.abort();},[]);
 if(!alerts.length)return null;
 return <aside className="clean-notice" role="status"><h2>Consultation manager review due</h2>{alerts.map(a=><p key={`${a.block_id}:${a.consultation_id}:${a.review_date}`}>{a.snapshot.title} · Internal review date {a.review_date}. Open Management review → Delivery & alerts to review the service evidence.</p>)}</aside>;
}
