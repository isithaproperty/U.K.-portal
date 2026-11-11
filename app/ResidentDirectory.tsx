"use client";
import {useState} from "react";
import ResidentArchiveAction from "./ResidentArchiveAction";
import type {Block,Unit,Resident} from "./types";

export default function ResidentDirectory({blocks,units,residents:allResidents}:{blocks:Block[];units:Unit[];residents:Resident[]}){
 const [archived,setArchived]=useState(false);
 const residents=allResidents.filter(r=>Boolean(r.archivedAt)===archived);
 const[selectedBlock,setSelectedBlock]=useState<number|"all">("all"),[residentQuery,setResidentQuery]=useState("");
 const unitById=new Map(units.map(unit=>[unit.id,unit]));
 const blockById=new Map(blocks.map(block=>[block.id,block]));
 const search=residentQuery.trim().toLowerCase();
 const matchingResidents=residents.filter(resident=>{
  if(selectedBlock!=="all"&&resident.blockId!==selectedBlock)return false;
  if(!search)return true;
  const unit=unitById.get(resident.unitId);
  const block=blockById.get(resident.blockId);
  return [resident.fullName,resident.email,resident.phone??"",unit?.unitNumber??"",block?.name??""].some(value=>value.toLowerCase().includes(search));
 });
 const groupedBlocks=blocks.filter(block=>matchingResidents.some(resident=>resident.blockId===block.id));
 return <><p>Search current or archived residents in the available blocks.</p>
 <section className="stat-grid three"><Stat label="Residents" value={residents.length} note="Live Supabase records" tone="blue"/><Stat label="Blocks with residents" value={new Set(residents.map(r=>r.blockId)).size} note="Blocks remain independent" tone="green"/><Stat label="Assigned units" value={new Set(residents.map(r=>r.unitId)).size} note="Resident-linked units" tone="amber"/></section>
 <nav className="tenant-tabs"><button className={!archived?"active":""} onClick={()=>setArchived(false)}>Current residents</button><button className={archived?"active":""} onClick={()=>setArchived(true)}>Archive</button></nav><div className="resident-toolbar"><label>Block<select value={selectedBlock} onChange={e=>setSelectedBlock(e.target.value==="all"?"all":Number(e.target.value))}><option value="all">All blocks with residents</option>{blocks.map(block=><option key={block.id} value={block.id}>{block.name}</option>)}</select></label><label>Find resident<input value={residentQuery} onChange={e=>setResidentQuery(e.target.value)} placeholder="Name, email, phone or unit…"/></label></div>
 {groupedBlocks.length===0?<div className="feature-panel"><span>◎</span><h2>No matching residents</h2><p>{residents.length===0?"No resident records have been added yet.":"No resident matches the selected block or search."}</p></div>:<div className="resident-blocks">{groupedBlocks.map(block=>{const blockResidents=matchingResidents.filter(resident=>resident.blockId===block.id);return <section className="panel resident-block-panel" key={block.id}><div className="resident-block-head"><div><p className="eyebrow">BLOCK</p><h2>{block.name}</h2><span>{block.address.replace(/\n/g,", ")}</span></div><strong>{blockResidents.length} {blockResidents.length===1?"resident":"residents"}</strong></div><div className="resident-live-head"><span>Resident</span><span>Unit</span><span>Contact</span></div>{blockResidents.map(resident=>{const unit=unitById.get(resident.unitId);const initials=resident.fullName.split(" ").filter(Boolean).map(part=>part[0]).slice(0,2).join("").toUpperCase();return <article className="resident-live-row" key={resident.id}><span className="resident-avatar-live">{initials}</span><div><b>{resident.fullName}</b><small>{resident.email}</small></div><div><span>Unit</span><b>{unit?.unitNumber??"Unassigned"}</b></div><div><span>Phone</span><b>{resident.phone||"Not provided"}</b></div><ResidentArchiveAction resident={resident}/></article>})}</section>})}</div>}</>
}

function Stat({label,value,note,tone,onClick}:{label:string;value:number|string;note:string;tone:string;onClick?:()=>void}){return <article className={`stat ${tone} ${onClick?"clickable":""}`} onClick={onClick} onKeyDown={e=>{if(onClick&&(e.key==="Enter"||e.key===" ")){e.preventDefault();onClick();}}} role={onClick?"button":undefined} tabIndex={onClick?0:undefined}><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div><i>▦</i></article>}
