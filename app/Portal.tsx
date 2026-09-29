"use client";
import {useState} from "react";
import BlockRegister from "./BlockRegister";
import type {Block} from "./types";

type View="overview"|"buildings"|"golden"|"maintenance"|"contractors"|"residents"|"finance"|"messages";
const nav:[View,string,string][]=[["overview","Portfolio overview","⌂"],["buildings","Buildings","▦"],["golden","Building safety","◇"],["maintenance","Work orders","⌁"],["contractors","Contractors","♢"],["residents","Residents","◎"],["finance","Service charges","£"],["messages","Communications","□"]];
const headings=["Building registration","Safety case","Fire safety","Structural safety","Plans & drawings","Maintenance & inspections","Changes & refurbishments","Mandatory occurrences","Incidents & emergencies","Resident engagement","Complaints & concerns","Audit & assurance"];

export default function Portal({blocks}:{blocks:Block[]}){
 const[view,setView]=useState<View>("overview"),[mobile,setMobile]=useState(false),[query,setQuery]=useState("");
 return <main className="app-shell">
  <aside className={`sidebar ${mobile?"open":""}`}><div className="brand"><div><strong>London Property Portal</strong><span>Property management</span></div></div><button className="close-nav" aria-label="Close menu" onClick={()=>setMobile(false)}>×</button><div className="portfolio-switch"><span>PORTFOLIO</span><button>UK Residential</button></div><nav>{nav.map(([key,label,icon])=><button key={key} className={view===key?"active":""} onClick={()=>{setView(key);setMobile(false);setQuery("")}}><i>{icon}</i>{label}</button>)}</nav><div className="side-footer"><div className="user"><span>BK</span><div><b>Brian Klue</b><small>Portfolio manager</small></div></div></div></aside>
  <section className="workspace"><header><button className="menu" aria-label="Open menu" onClick={()=>setMobile(true)}>☰</button><div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} onFocus={()=>setView("buildings")} placeholder="Search blocks, addresses, companies…"/></div></header><div className="content">
   {view==="overview"&&<Overview go={setView} blocks={blocks}/>}
   {view==="buildings"&&<BlockRegister globalQuery={query} blocks={blocks}/>}
   {view==="golden"&&<BuildingSafety blocks={blocks}/>}
   {view==="maintenance"&&<EmptyModule title="Work orders" description="No work orders have been added to this portal."/>}
   {view==="contractors"&&<EmptyModule title="Contractors" description="No contractors have been added to this portal."/>}
   {view==="residents"&&<EmptyModule title="Residents & leaseholders" description="No resident records have been added to this portal."/>}
   {view==="finance"&&<EmptyModule title="Service charges & arrears" description="No service charge or arrears data has been added to this portal."/>}
   {view==="messages"&&<EmptyModule title="Communications" description="No notices or messages have been added to this portal."/>}
  </div></section></main>
}
function Overview({go,blocks}:{go:(view:View)=>void;blocks:Block[]}){
 return <><div className="page-head"><div><p className="eyebrow">PORTFOLIO OVERVIEW</p><h1>Good morning, Brian</h1><p>{blocks.length} blocks in the register · Imported 28 September 2026</p></div></div>
 <section className="stat-grid"><Stat label="Blocks" value={blocks.length} note="Imported register" tone="blue"/><Stat label="Units" value={blocks.reduce((total,b)=>total+b.units,0)} note="Across the block list" tone="green"/><Stat label="Work orders" value={0} note="Live portal records" tone="amber"/><Stat label="Contractors" value={0} note="Live portal records" tone="blue"/></section>
 <div className="clean-overview-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">YOUR PORTFOLIO</p><h2>Blocks at a glance</h2></div><button onClick={()=>go("buildings")}>View all blocks</button></div><div className="clean-block-preview">{blocks.slice(0,5).map(b=><button key={b.id} onClick={()=>go("buildings")}><b>{b.name}</b><span>{b.address.replace(/\n/g,", ")}</span><strong>{b.units} units</strong></button>)}</div></section><section className="panel clean-next"><p className="eyebrow">NEXT STEPS</p><h2>Your workspace is ready</h2><p>Open the block list to review the imported details. Work orders and contractors will appear here as they are added.</p><button className="primary" onClick={()=>go("buildings")}>Open block list</button></section></div></>
}
function Stat({label,value,note,tone}:{label:string;value:number|string;note:string;tone:string}){return <article className={`stat ${tone}`}><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div><i>▦</i></article>}
function BuildingSafety({blocks}:{blocks:Block[]}){const[building,setBuilding]=useState(blocks[0]?.name ?? ""),selected=blocks.find(x=>x.name===building);return <><div className="page-head"><div><p className="eyebrow">BUILDING SAFETY</p><h1>Golden Thread</h1><p>Choose a block to view its safety record.</p></div></div>{selected && <div className="building-context"><label>Building<select value={building} onChange={e=>setBuilding(e.target.value)}>{blocks.map(x=><option key={x.id}>{x.name}</option>)}</select></label><div><span>{selected?.units ?? 0} units</span><small>{selected?.address.replace(/\n/g,", ")}</small></div></div>}<div className="clean-notice">No safety records have been added for {selected?.name ?? "this portfolio"}. Compliance scores and statuses will appear only when supported by actual records.</div><div className="safety-empty-grid">{headings.map(x=><article className="panel" key={x}><span>▰</span><h2>{x}</h2><p>No records added</p></article>)}</div></>}
function EmptyModule({title,description}:{title:string;description:string}){return <><div className="page-head"><div><p className="eyebrow">MANAGEMENT</p><h1>{title}</h1></div></div><div className="feature-panel"><span>◇</span><h2>No records yet</h2><p>{description}</p></div></>}
