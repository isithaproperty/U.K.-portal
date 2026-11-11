"use client";
import {useState} from "react";
import DebtorRegister from "./DebtorRegister";
import LeaseholderPlanning from "./LeaseholderPlanning";
import DeliveryRegister from "./DeliveryRegister";
import StandingOrderRegister from "./StandingOrderRegister";
import CreditorRegister from "./CreditorRegister";
import type {Block,Unit,Resident,WorkOrder,Contractor} from "./types";
import type {ChargeEntry} from "../lib/service-charges";
import "./management-review.css";
const tabs=["Leaseholders & Section 20","Debtors","Creditors","Standing orders","Delivery & alerts"] as const;
export default function ManagementReview({blocks,units,residents,workOrders,contractors,entries,today,synthetic=false,canRecordSettlements=false,initialTab=0}:{blocks:Block[];units:Unit[];residents:Resident[];workOrders:WorkOrder[];contractors:Contractor[];entries:ChargeEntry[];today:string;synthetic?:boolean;canRecordSettlements?:boolean;initialTab?:number}){
 const [tab,setTab]=useState<number>(initialTab>=0&&initialTab<tabs.length?initialTab:0);
 return <section className="management-review"><div className="page-head"><div><p className="eyebrow">LONDON PROPERTY PORTAL</p><h1>Management review workspace</h1><p>{synthetic?"Synthetic examples for reviewing the requested adjustments.":"Prepare the requested workflows using your accessible portfolio records."}</p></div></div><aside className="review-banner"><strong>Manager approval required</strong><p>Use each area’s explicit Save button to retain review records once the reviewed database migration is installed. Unsaved edits are lost when you leave or refresh; exports keep a separate copy. Ledger posting and email delivery require explicit approval and separate activation. Background jobs start disabled.</p></aside><nav className="review-tabs" aria-label="Management review areas">{tabs.map((name,i)=><button type="button" key={name} aria-current={tab===i?"page":undefined} onClick={()=>setTab(i)}>{name}</button>)}</nav><div hidden={tab!==0}><LeaseholderPlanning blocks={blocks} units={units} residents={residents} today={today} reviewOnly={synthetic}/></div><div hidden={tab!==1}><DebtorRegister blocks={blocks} units={units} residents={residents} entries={entries} today={today} reviewOnly={synthetic}/></div><div hidden={tab!==2}><CreditorRegister canRecordSettlements={canRecordSettlements&&!synthetic} blocks={blocks} workOrders={workOrders} contractors={contractors} today={today} reviewOnly={synthetic}/></div><div hidden={tab!==3}><StandingOrderRegister blocks={blocks} units={units} today={today} reviewOnly={synthetic}/></div><div hidden={tab!==4}><DeliveryRegister preparationScope="management" blocks={blocks} reviewOnly={synthetic}/></div></section>;
}
