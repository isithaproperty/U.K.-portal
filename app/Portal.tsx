"use client";
import {useState} from "react";
import BlockRegister from "./BlockRegister";
import UnitRegister from "./UnitRegister";
import type {Block,Unit,Resident} from "./types";

type View="overview"|"buildings"|"units"|"golden"|"maintenance"|"contractors"|"residents"|"finance"|"messages";
const nav:[View,string,string][]=[["overview","Portfolio overview","⌂"],["buildings","Buildings","▦"],["units","Units & residents","◎"],["golden","Building safety","◇"],["maintenance","Work orders","⌁"],["contractors","Contractors","♢"],["residents","Residents","◎"],["finance","Service charges","£"],["messages","Communications","□"]];
const headings=["Building registration","Safety case","Fire safety","Structural safety","Plans & drawings","Maintenance & inspections","Changes & refurbishments","Mandatory occurrences","Incidents & emergencies","Resident engagement","Complaints & concerns","Audit & assurance"];

export default function Portal({blocks,units,residents,isManager,viewerEmail}:{blocks:Block[];units:Unit[];residents:Resident[];isManager:boolean;viewerEmail:string}){
 const[view,setView]=useState<View>("overview"),[mobile,setMobile]=useState(false),[query,setQuery]=useState(""),[unitBlock,setUnitBlock]=useState<number|null>(null);
 const visibleNav=isManager?nav:nav.filter(([key])=>["overview","buildings","golden"].includes(key));
 const ownUnits=units.filter(unit=>residents.some(resident=>resident.unitId===unit.id&&resident.email===viewerEmail));
 const viewerName=isManager?viewerEmail.split("@")[0].split(/[._-]/).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(" "):residents.find(resident=>resident.email===viewerEmail)?.fullName??"Resident";
 return <main className="app-shell">
  <aside className={`sidebar ${mobile?"open":""}`}><div className="brand"><div><strong>London Property Portal</strong><span>Property management</span></div></div><button className="close-nav" aria-label="Close menu" onClick={()=>setMobile(false)}>×</button><div className="portfolio-switch"><span>PORTFOLIO</span><button>{isManager?"UK Residential":"My property"}</button></div><nav>{visibleNav.map(([key,label,icon])=><button key={key} className={view===key?"active":""} onClick={()=>{setView(key);setMobile(false);setQuery("")}}><i>{icon}</i>{label}</button>)}</nav><div className="side-footer"><div className="user"><span>{viewerName.split(" ").map(part=>part[0]).slice(0,2).join("").toUpperCase()}</span><div><b>{viewerName}</b><small>{isManager?"Portfolio manager":"Resident"}</small></div></div><button className="sign-out" onClick={async()=>{const {createClient}=await import("../lib/supabase/browser");await createClient().auth.signOut();window.location.href="/login";}}>Sign out</button></div></aside>
  <section className="workspace"><header><button className="menu" aria-label="Open menu" onClick={()=>setMobile(true)}>☰</button><div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} onFocus={()=>setView("buildings")} placeholder="Search your blocks and addresses…"/></div></header><div className="content">
   {view==="overview"&&<Overview go={setView} blocks={blocks} isManager={isManager} viewerName={viewerName} ownUnitCount={ownUnits.length}/>}
   {view==="buildings"&&<BlockRegister globalQuery={query} blocks={blocks} units={units} residents={residents} ownUnits={ownUnits} onManage={isManager?(id)=>{setUnitBlock(id);setView("units");}:undefined}/>}
   {view==="units"&&isManager&&<UnitRegister key={unitBlock??0} blocks={blocks} units={units} residents={residents} initialBlockId={unitBlock}/>}
   {view==="golden"&&<BuildingSafety blocks={blocks}/>}
   {view==="maintenance"&&<EmptyModule title="Work orders" description="No work orders have been added to this portal."/>}
   {view==="contractors"&&<EmptyModule title="Contractors" description="No contractors have been added to this portal."/>}
   {view==="residents"&&isManager&&<ResidentRegister blocks={blocks} units={units} residents={residents}/>}
   {view==="finance"&&<EmptyModule title="Service charges & arrears" description="No service charge or arrears data has been added to this portal."/>}
   {view==="messages"&&<EmptyModule title="Communications" description="No notices or messages have been added to this portal."/>}
  </div></section></main>
}
function Overview({go,blocks,isManager,viewerName,ownUnitCount}:{go:(view:View)=>void;blocks:Block[];isManager:boolean;viewerName:string;ownUnitCount:number}){
 return <><div className="page-head"><div><p className="eyebrow">PORTFOLIO OVERVIEW</p><h1>{isManager?`Good morning, ${viewerName.split(" ")[0]}`:"Your property portfolio"}</h1><p>{blocks.length} {blocks.length===1?"block":"blocks"} available to your account</p></div></div>
 <section className="stat-grid"><Stat label="Blocks" value={blocks.length} note="Accessible to you" tone="blue"/><Stat label={isManager?"Units":"My units"} value={isManager?blocks.reduce((total,b)=>total+b.units,0):ownUnitCount} note={isManager?"Across the block list":"Assigned to your email"} tone="green"/>{isManager&&<><Stat label="Work orders" value={0} note="Live portal records" tone="amber"/><Stat label="Contractors" value={0} note="Live portal records" tone="blue"/></>}</section>
 <div className="clean-overview-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">YOUR PORTFOLIO</p><h2>Blocks at a glance</h2></div><button onClick={()=>go("buildings")}>View blocks</button></div><div className="clean-block-preview">{blocks.slice(0,5).map(b=><button key={b.id} onClick={()=>go("buildings")}><b>{b.name}</b><span>{b.address.replace(/\n/g,", ")}</span><strong>{b.units} units</strong></button>)}</div></section><section className="panel clean-next"><p className="eyebrow">NEXT STEPS</p><h2>Your workspace is ready</h2><p>{isManager?"Open a block to add units and residents.":"Open your block to see the property details assigned to you."}</p><button className="primary" onClick={()=>go("buildings")}>Open blocks</button></section></div></>
}
function Stat({label,value,note,tone}:{label:string;value:number|string;note:string;tone:string}){return <article className={`stat ${tone}`}><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div><i>▦</i></article>}
function BuildingSafety({blocks}:{blocks:Block[]}){const[building,setBuilding]=useState(blocks[0]?.name ?? ""),selected=blocks.find(x=>x.name===building);return <><div className="page-head"><div><p className="eyebrow">BUILDING SAFETY</p><h1>Golden Thread</h1><p>Choose a block to view its safety record.</p></div></div>{selected && <div className="building-context"><label>Building<select value={building} onChange={e=>setBuilding(e.target.value)}>{blocks.map(x=><option key={x.id}>{x.name}</option>)}</select></label><div><span>{selected?.units ?? 0} units</span><small>{selected?.address.replace(/\n/g,", ")}</small></div></div>}<div className="clean-notice">No safety records have been added for {selected?.name ?? "this portfolio"}. Compliance scores and statuses will appear only when supported by actual records.</div><div className="safety-empty-grid">{headings.map(x=><article className="panel" key={x}><span>▰</span><h2>{x}</h2><p>No records added</p></article>)}</div></>}
function ResidentRegister({blocks,units,residents}:{blocks:Block[];units:Unit[];residents:Resident[]}){
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
 return <><div className="page-head"><div><p className="eyebrow">RESIDENT MANAGEMENT</p><h1>Residents & leaseholders</h1><p>Live resident records are kept separate by block and unit.</p></div></div>
 <section className="stat-grid three"><Stat label="Residents" value={residents.length} note="Live Supabase records" tone="blue"/><Stat label="Blocks with residents" value={new Set(residents.map(r=>r.blockId)).size} note="Blocks remain independent" tone="green"/><Stat label="Assigned units" value={new Set(residents.map(r=>r.unitId)).size} note="Resident-linked units" tone="amber"/></section>
 <div className="resident-toolbar"><label>Block<select value={selectedBlock} onChange={e=>setSelectedBlock(e.target.value==="all"?"all":Number(e.target.value))}><option value="all">All blocks with residents</option>{blocks.map(block=><option key={block.id} value={block.id}>{block.name}</option>)}</select></label><label>Find resident<input value={residentQuery} onChange={e=>setResidentQuery(e.target.value)} placeholder="Name, email, phone or unit…"/></label></div>
 {groupedBlocks.length===0?<div className="feature-panel"><span>◎</span><h2>No matching residents</h2><p>{residents.length===0?"No resident records have been added yet.":"No resident matches the selected block or search."}</p></div>:<div className="resident-blocks">{groupedBlocks.map(block=>{const blockResidents=matchingResidents.filter(resident=>resident.blockId===block.id);return <section className="panel resident-block-panel" key={block.id}><div className="resident-block-head"><div><p className="eyebrow">BLOCK</p><h2>{block.name}</h2><span>{block.address.replace(/\n/g,", ")}</span></div><strong>{blockResidents.length} {blockResidents.length===1?"resident":"residents"}</strong></div><div className="resident-live-head"><span>Resident</span><span>Unit</span><span>Contact</span></div>{blockResidents.map(resident=>{const unit=unitById.get(resident.unitId);const initials=resident.fullName.split(" ").filter(Boolean).map(part=>part[0]).slice(0,2).join("").toUpperCase();return <article className="resident-live-row" key={resident.id}><span className="resident-avatar-live">{initials}</span><div><b>{resident.fullName}</b><small>{resident.email}</small></div><div><span>Unit</span><b>{unit?.unitNumber??"Unassigned"}</b></div><div><span>Phone</span><b>{resident.phone||"Not provided"}</b></div></article>})}</section>})}</div>}</>
}
function EmptyModule({title,description}:{title:string;description:string}){return <><div className="page-head"><div><p className="eyebrow">MANAGEMENT</p><h1>{title}</h1></div></div><div className="feature-panel"><span>◇</span><h2>No records yet</h2><p>{description}</p></div></>}
