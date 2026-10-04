"use client";
import {chargeSummary,money,type ChargeEntry} from "../lib/service-charges";
import type {Block,Unit,Resident} from "./types";

export default function OutstandingBalances({entries,today,blocks,units,residents,onOpenBlock,onBack}:{entries:ChargeEntry[];today:string;blocks:Block[];units:Unit[];residents:Resident[];onOpenBlock:(id:number)=>void;onBack:()=>void}){
 const rows=units.map(unit=>{
  const summary=chargeSummary(entries.filter(e=>e.unit_id===unit.id),today);
  const block=blocks.find(b=>b.id===unit.blockId);
  const people=residents.filter(r=>!r.archivedAt&&r.unitId===unit.id);
  const oldest=entries.filter(e=>e.unit_id===unit.id&&e.entry_type==="Charge"&&e.due_date&&e.due_date<today&&summary.remaining[e.id]>0).sort((a,b)=>(a.due_date??"").localeCompare(b.due_date??""))[0];
  return {unit,summary,block,people,oldest};
 }).filter(row=>row.block&&row.summary.balance>0).sort((a,b)=>b.summary.balance-a.summary.balance);
 const total=rows.reduce((sum,row)=>sum+row.summary.balance,0);
 return <><div className="page-head"><div><p className="eyebrow">SERVICE CHARGES</p><h1>Outstanding balances</h1><p>See who owes the balance, their block and the responsible property manager.</p></div><button className="secondary" onClick={onBack}>← Dashboard</button></div>
 <section className="panel"><div className="panel-head"><div><p className="eyebrow">PORTFOLIO TOTAL</p><h2>{money(total)} outstanding</h2></div><strong>{rows.length} {rows.length===1?"account":"accounts"}</strong></div>
 <div className="table-wrap"><table><thead><tr><th>Block</th><th>Property manager</th><th>Property / unit</th><th>Resident / leaseholder</th><th>Outstanding</th><th>Overdue</th><th>Oldest due</th><th></th></tr></thead><tbody>{rows.map(row=><tr key={row.unit.id}><td><button className="link-button" onClick={()=>onOpenBlock(row.block!.id)}>{row.block!.name}</button></td><td>{row.block!.manager||"—"}</td><td>{row.unit.unitNumber}</td><td>{row.people.length?row.people.map(p=>p.fullName).join(", "):"No resident assigned"}</td><td><strong>{money(row.summary.balance)}</strong></td><td>{money(row.summary.overdue)}</td><td>{row.oldest?.due_date??"—"}</td><td><button className="secondary" onClick={()=>onOpenBlock(row.block!.id)}>View block</button></td></tr>)}</tbody></table>{rows.length===0&&<div className="empty-state">No outstanding service charge balances.</div>}</div></section></>;
}
