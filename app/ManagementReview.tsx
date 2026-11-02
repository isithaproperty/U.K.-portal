"use client";
import {useState} from "react";
import FinancialPlanning from "./FinancialPlanning";
import DebtorRegister from "./DebtorRegister";
import LeaseholderPlanning from "./LeaseholderPlanning";
import CreditorRegister from "./CreditorRegister";
import type {Block,Unit,Resident,WorkOrder,Contractor} from "./types";
import type {ChargeEntry} from "../lib/service-charges";
import "./management-review.css";
const tabs=["Financials","Leaseholders & Section 20","Debtors","Creditors"] as const;
export default function ManagementReview({blocks,units,residents,workOrders,contractors,entries,today,synthetic=false,canPostBatches=false}:{blocks:Block[];units:Unit[];residents:Resident[];workOrders:WorkOrder[];contractors:Contractor[];entries:ChargeEntry[];today:string;synthetic?:boolean;canPostBatches?:boolean}){
 const [tab,setTab]=useState<number>(0);
 return <section className="management-review"><div className="page-head"><div><p className="eyebrow">LONDON PROPERTY PORTAL</p><h1>Management review workspace</h1><p>{synthetic?"Synthetic examples for reviewing the requested adjustments.":"Prepare the requested workflows using your accessible portfolio records."}</p></div></div><aside className="review-banner"><strong>Draft review only</strong><p>Use each area’s explicit Save button to retain review records once the reviewed database migration is installed. Unsaved edits are lost when you leave or refresh; exports keep a separate copy. Ledger posting, email delivery and background jobs are disabled.</p></aside><nav className="review-tabs" aria-label="Management review areas">{tabs.map((name,i)=><button type="button" key={name} aria-current={tab===i?"page":undefined} onClick={()=>setTab(i)}>{name}</button>)}</nav><div hidden={tab!==0}><FinancialPlanning canPost={canPostBatches&&!synthetic} blocks={blocks} units={units} residents={residents} entries={entries} today={today} reviewOnly={synthetic}/></div><div hidden={tab!==1}><LeaseholderPlanning blocks={blocks} units={units} residents={residents} today={today} reviewOnly={synthetic}/></div><div hidden={tab!==2}><DebtorRegister blocks={blocks} units={units} residents={residents} entries={entries} today={today} reviewOnly={synthetic}/></div><div hidden={tab!==3}><CreditorRegister blocks={blocks} workOrders={workOrders} contractors={contractors} today={today} reviewOnly={synthetic}/></div></section>;
}
