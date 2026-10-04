"use client";
import {chargeSummary,money,type ChargeEntry} from "../lib/service-charges";
import type {Block,Unit,Resident} from "./types";

type Props={
 blocks:Block[];
 units:Unit[];
 residents:Resident[];
 entries:ChargeEntry[];
 today:string;
 onOpenBlock:(blockId:number)=>void;
};

export default function ServiceChargeDashboard({blocks,units,residents,entries,today,onOpenBlock}:Props){
 const rows=blocks.map(block=>{
  const blockEntries=entries.filter(entry=>entry.block_id===block.id);
  const summary=chargeSummary(blockEntries,today);
  const raised=summary.totalCharges;
  const paid=Math.min(raised,summary.payments+summary.credits);
  const outstanding=Math.max(0,summary.balance);
  const residentCount=residents.filter(resident=>resident.blockId===block.id&&!resident.archivedAt).length;
  const unitCount=units.filter(unit=>unit.blockId===block.id).length;
  return {block,raised,paid,outstanding,residentCount,unitCount};
 });
 const totals=rows.reduce((acc,row)=>({raised:acc.raised+row.raised,paid:acc.paid+row.paid,outstanding:acc.outstanding+row.outstanding}),{raised:0,paid:0,outstanding:0});
 return <section className="panel" style={{marginTop:24}}>
  <div className="panel-head"><div><p className="eyebrow">SERVICE CHARGES</p><h2>Raised, paid & outstanding by block</h2><p>Click a block to view the resident and unit detail.</p></div></div>
  <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th style={head}>Block</th><th style={head}>Units / residents</th><th style={head}>Raised</th><th style={head}>Paid</th><th style={head}>Outstanding</th></tr></thead><tbody>
   {rows.map(row=><tr key={row.block.id} onClick={()=>onOpenBlock(row.block.id)} style={{cursor:"pointer",borderTop:"1px solid #ece6da"}}><td style={cell}><b>{row.block.name}</b></td><td style={cell}>{row.unitCount} / {row.residentCount}</td><td style={cell}>{money(row.raised)}</td><td style={cell}>{money(row.paid)}</td><td style={cell}><b>{money(row.outstanding)}</b></td></tr>)}
  </tbody><tfoot><tr style={{borderTop:"2px solid #d8cdbb"}}><td style={cell}><b>Portfolio total</b></td><td style={cell}></td><td style={cell}><b>{money(totals.raised)}</b></td><td style={cell}><b>{money(totals.paid)}</b></td><td style={cell}><b>{money(totals.outstanding)}</b></td></tr></tfoot></table></div>
 </section>;
}
const head:React.CSSProperties={textAlign:"left",padding:"12px 14px",fontSize:12,textTransform:"uppercase",letterSpacing:".05em",color:"#6e665b"};
const cell:React.CSSProperties={padding:"14px"};
