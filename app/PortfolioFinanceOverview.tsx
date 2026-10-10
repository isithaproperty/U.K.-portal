"use client";
import {useMemo,useState} from "react";
import {chargeSummary,money,type ChargeEntry} from "../lib/service-charges";
import type {Block,Unit,Resident,WorkOrder} from "./types";

type Props={entries:ChargeEntry[];today:string;blocks:Block[];units:Unit[];residents:Resident[];workOrders:WorkOrder[];onOpenBlock:(id:number)=>void};
export default function PortfolioFinanceOverview({entries,today,blocks,units,residents,workOrders,onOpenBlock}:Props){
 const [manager,setManager]=useState<string|null>(null);
 const rows=useMemo(()=>blocks.map(block=>{
  const blockUnits=units.filter(u=>u.blockId===block.id);
  const balances=blockUnits.map(unit=>({unit,summary:chargeSummary(entries.filter(e=>e.unit_id===unit.id),today)}));
  const owed=balances.reduce((n,x)=>n+Math.max(0,x.summary.balance),0);
  const overdue=balances.reduce((n,x)=>n+x.summary.overdue,0);
  const paid=balances.reduce((n,x)=>n+x.summary.payments,0);
  const expenses=workOrders.filter(w=>w.blockId===block.id).reduce((n,w)=>n+(w.actualCost??w.estimatedCost??0)*100,0);
  return {block,balances,owed,overdue,paid,expenses};
 }),[blocks,units,entries,today,workOrders]);
 const managers=[...new Set(blocks.map(b=>b.manager||"Unassigned"))].map(name=>{const owned=rows.filter(r=>(r.block.manager||"Unassigned")===name);return {name,blocks:owned,owed:owned.reduce((n,r)=>n+r.owed,0),overdue:owned.reduce((n,r)=>n+r.overdue,0),paid:owned.reduce((n,r)=>n+r.paid,0),expenses:owned.reduce((n,r)=>n+r.expenses,0)};});
 const totalOwed=managers.reduce((n,m)=>n+m.owed,0),totalExpenses=managers.reduce((n,m)=>n+m.expenses,0),totalPaid=managers.reduce((n,m)=>n+m.paid,0);
 const selected=managers.find(m=>m.name===manager);
 return <section className="panel"><div className="panel-head"><div><p className="eyebrow">PORTFOLIO FINANCE</p><h2>Money owed and outgoing expenses</h2><p>Live totals from service-charge accounts and recorded work-order costs.</p></div></div>
 <div className="stat-grid"><div className="stat"><span>Outstanding service charges</span><strong>{money(totalOwed)}</strong></div><div className="stat"><span>Service-charge payments received</span><strong>{money(totalPaid)}</strong></div><div className="stat"><span>Recorded outgoing works</span><strong>{money(totalExpenses)}</strong></div></div>
 {!selected?<div className="table-wrap"><table><thead><tr><th>Property manager</th><th>Blocks</th><th>Outstanding</th><th>Overdue</th><th>Payments received</th><th>Outgoing works</th><th></th></tr></thead><tbody>{managers.map(m=><tr key={m.name}><td><strong>{m.name}</strong></td><td>{m.blocks.length}</td><td>{money(m.owed)}</td><td>{money(m.overdue)}</td><td>{money(m.paid)}</td><td>{money(m.expenses)}</td><td><button className="secondary" onClick={()=>setManager(m.name)}>View blocks</button></td></tr>)}</tbody></table></div>:
 <><div className="panel-head"><div><p className="eyebrow">PROPERTY MANAGER</p><h2>{selected.name}</h2></div><button className="secondary" onClick={()=>setManager(null)}>← All managers</button></div><div className="table-wrap"><table><thead><tr><th>Block</th><th>Outstanding</th><th>Overdue</th><th>Payments received</th><th>Outgoing works</th><th></th></tr></thead><tbody>{selected.blocks.map(r=><tr key={r.block.id}><td><strong>{r.block.name}</strong></td><td>{money(r.owed)}</td><td>{money(r.overdue)}</td><td>{money(r.paid)}</td><td>{money(r.expenses)}</td><td><button className="secondary" onClick={()=>onOpenBlock(r.block.id)}>View block & names</button></td></tr>)}</tbody></table></div></>}
 <p className="unit-message">Outgoing works currently use the actual work-order cost where entered, otherwise the estimated cost. As real service-charge, resident and work-order data is uploaded, these totals update automatically.</p></section>;
}
