"use client";
import Image from "next/image";
import dashboardLogo from "../public/aviaf-dashboard-logo.png";
import ResidentArchiveAction from "./ResidentArchiveAction";
import {useState} from "react";
import BlockRegister from "./BlockRegister";
import UnitRegister from "./UnitRegister";
import ServiceChargeRegister from "./ServiceChargeRegister";
import {chargeSummary,type ChargeEntry} from "../lib/service-charges";
import TenantRequestRegister from "./TenantRequestRegister";
import type {TenantRequest} from "./tenant/TenantPortal";
import BlockDashboard from "./BlockDashboard";
import ContractorRegister from "./ContractorRegister";
import WorkOrderRegister from "./WorkOrderRegister";
import BuildingSafetyRegister from "./BuildingSafetyRegister";
import CommunicationRegister from "./CommunicationRegister";
import type {Block,Unit,Resident,WorkOrder,Contractor,ContractorDocument,BuildingSafetyRecord} from "./types";

type View="overview"|"buildings"|"block"|"units"|"golden"|"maintenance"|"contractors"|"residents"|"finance"|"messages";
const nav:[View,string,string][]=[["overview","Portfolio overview","⌂"],["buildings","Buildings","▦"],["units","Units & residents","◎"],["golden","Health & Safety","◇"],["maintenance","Work orders","⌁"],["contractors","Contractors","♢"],["residents","Residents","◎"],["finance","Service charges","£"],["messages","Communications","□"]];
const headings=["Building registration","Safety case","Fire safety","Structural safety","Plans & drawings","Maintenance & inspections","Changes & refurbishments","Mandatory occurrences","Incidents & emergencies","Resident engagement","Complaints & concerns","Audit & assurance"];

export default function Portal({serviceCharges,today,tenantRequests,blocks,units,residents:allResidents,workOrders,contractors,contractorDocuments,buildingSafetyRecords,isManager,memberRole,portfolioManager,viewerEmail}:{serviceCharges:ChargeEntry[];today:string;tenantRequests:TenantRequest[];blocks:Block[];units:Unit[];residents:Resident[];workOrders:WorkOrder[];contractors:Contractor[];contractorDocuments:ContractorDocument[];buildingSafetyRecords:BuildingSafetyRecord[];isManager:boolean;memberRole:string|null;portfolioManager:string|null;viewerEmail:string}){
 const residents=allResidents.filter(r=>!r.archivedAt);
 const[view,setView]=useState<View>("overview"),[mobile,setMobile]=useState(false),[query,setQuery]=useState(""),[unitBlock,setUnitBlock]=useState<number|null>(null),[selectedBlockId,setSelectedBlockId]=useState<number|null>(null);
 const visibleNav=isManager?nav:nav.filter(([key])=>["overview","buildings","golden"].includes(key));
 const ownUnits=units.filter(unit=>residents.some(resident=>resident.unitId===unit.id&&resident.email===viewerEmail));
 const viewerName=isManager?viewerEmail.split("@")[0].split(/[._-]/).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(" "):residents.find(resident=>resident.email===viewerEmail)?.fullName??"Resident";
 return <main className="app-shell">
  <aside className={`sidebar ${mobile?"open":""}`}><button className="close-nav" aria-label="Close menu" onClick={()=>setMobile(false)}>×</button><div className="portfolio-switch"><span>PORTFOLIO</span><button>{isManager?"UK Residential":"My property"}</button></div><nav>{visibleNav.map(([key,label,icon])=><button key={key} className={view===key?"active":""} onClick={()=>{setView(key);setMobile(false);setQuery("")}}><i>{icon}</i>{label}</button>)}</nav><div className="side-footer"><div className="user"><span>{viewerName.split(" ").map(part=>part[0]).slice(0,2).join("").toUpperCase()}</span><div><b>{viewerName}</b><small>{isManager?"Portfolio manager":"Resident"}</small></div></div><button className="sign-out" onClick={async()=>{const {createClient}=await import("../lib/supabase/browser");await createClient().auth.signOut();window.location.href="/login";}}>Sign out</button></div></aside>
  <section className="workspace"><header><button className="menu" aria-label="Open menu" onClick={()=>setMobile(true)}>☰</button><Image className="dashboard-brand" src={dashboardLogo} alt="AVIAF Asset Management" width={180} height={70} priority/><div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} onFocus={()=>setView("buildings")} placeholder="Search your blocks and addresses…"/></div></header><div className="content">
   {view==="overview"&&<Overview serviceCharges={serviceCharges} today={today} go={setView} blocks={blocks} isManager={isManager} viewerName={viewerName} ownUnitCount={ownUnits.length} contractors={contractors} workOrders={workOrders} buildingSafetyRecords={buildingSafetyRecords}/>}
   {view==="buildings"&&<BlockRegister globalQuery={query} blocks={blocks} ownUnits={ownUnits} onOpen={(id)=>{setSelectedBlockId(id);setView("block");}}/>}
   {view==="block"&&selectedBlockId&&blocks.find(b=>b.id===selectedBlockId)&&<BlockDashboard serviceCharges={serviceCharges} today={today} block={blocks.find(b=>b.id===selectedBlockId)!} units={units} residents={residents} workOrders={workOrders} contractors={contractors} onBack={()=>setView("buildings")}/>}
   {view==="units"&&isManager&&<UnitRegister key={unitBlock??0} blocks={blocks} units={units} residents={allResidents} initialBlockId={unitBlock}/>}
   {view==="golden"&&isManager&&<BuildingSafetyRegister blocks={blocks} records={buildingSafetyRecords}/>}
   {view==="maintenance"&&isManager&&<><TenantRequestRegister requests={tenantRequests} blocks={blocks} units={units} residents={allResidents}/><WorkOrderRegister blocks={blocks} workOrders={workOrders} viewerEmail={viewerEmail} memberRole={memberRole} portfolioManager={portfolioManager} onOpenBlock={(id)=>{setSelectedBlockId(id);setView("block");}}/></>}
   {view==="contractors"&&isManager&&<ContractorRegister contractors={contractors} documents={contractorDocuments}/>}
   {view==="residents"&&isManager&&<ResidentRegister blocks={blocks} units={units} residents={allResidents}/>}
   {view==="finance"&&<ServiceChargeRegister residents={residents} blocks={blocks} units={units} entries={serviceCharges} today={today}/>}
   {view==="messages"&&isManager&&<CommunicationRegister blocks={blocks} residents={residents}/>}
  </div></section></main>
}
function Overview({serviceCharges,today,go,blocks,isManager,viewerName,ownUnitCount,contractors=[],workOrders=[],buildingSafetyRecords=[]}:{serviceCharges:ChargeEntry[];today:string;go:(view:View)=>void;blocks:Block[];isManager:boolean;viewerName:string;ownUnitCount:number;contractors?:Contractor[];workOrders?:WorkOrder[];buildingSafetyRecords?:BuildingSafetyRecord[]}){
 const unitBalances=[...new Set(serviceCharges.map(e=>e.unit_id))].map(id=>chargeSummary(serviceCharges.filter(e=>e.unit_id===id),today));
 const arrears=unitBalances.reduce((n,s)=>n+s.overdue,0);
 const outstanding=unitBalances.reduce((n,s)=>n+Math.max(0,s.balance),0);
 const openWOs=workOrders.filter(wo=>wo.status!=="Complete").length;
 const safetyCounts={
  Current:buildingSafetyRecords.filter(r=>r.status==="Current").length,
  "Action required":buildingSafetyRecords.filter(r=>r.status==="Action required").length,
  "Under review":buildingSafetyRecords.filter(r=>r.status==="Under review").length,
  Expired:buildingSafetyRecords.filter(r=>r.status==="Expired").length
 };
 const paymentCounts={
  Awaiting:workOrders.filter(wo=>wo.status==="Complete"&&wo.paymentStatus==="Not approved").length,
  Approved:workOrders.filter(wo=>wo.paymentStatus==="Approved").length,
  Paid:workOrders.filter(wo=>wo.paymentStatus==="Paid").length
 };
 const woCounts={
  Open:workOrders.filter(wo=>wo.status==="Open").length,
  "In progress":workOrders.filter(wo=>wo.status==="In progress").length,
  "On hold":workOrders.filter(wo=>wo.status==="On hold").length,
  Complete:workOrders.filter(wo=>wo.status==="Complete").length
 };
 const managerNames=[...new Set(blocks.map(b=>b.manager))];
 const managerRows=managerNames.map(name=>{
  const ids=new Set(blocks.filter(b=>b.manager===name).map(b=>b.id));
  const safety=buildingSafetyRecords.filter(r=>ids.has(r.blockId));
  const current=safety.filter(r=>r.status==="Current").length;
  const total=safety.length;
  const compliance=total?Math.round((current/total)*100):0;
  const payments=workOrders.filter(wo=>ids.has(wo.blockId));
  return {
   name,
   blocks:[...ids].length,
   compliance,
   outstandingSafety:safety.filter(r=>r.status!=="Current").length,
   openWOs:payments.filter(wo=>wo.status!=="Complete").length,
   awaitingPayment:payments.filter(wo=>wo.status==="Complete"&&wo.paymentStatus==="Not approved").length
  };
 });
 return <><div className="page-head"><div><p className="eyebrow">PORTFOLIO OVERVIEW</p><h1>{isManager?`Good morning, ${viewerName.split(" ")[0]}`:"Your property portfolio"}</h1><p>{blocks.length} {blocks.length===1?"block":"blocks"} available to your account</p></div></div>
 <section className="stat-grid"><Stat label="Blocks" value={blocks.length} note="Accessible to you" tone="blue" onClick={()=>go("buildings")}/><Stat label={isManager?"Units":"My units"} value={isManager?blocks.reduce((total,b)=>total+b.units,0):ownUnitCount} note={isManager?"Across the block list":"Assigned to your email"} tone="green" onClick={()=>go(isManager?"units":"buildings")}/>{isManager&&<><Stat label="Open work orders" value={openWOs} note="Live portfolio jobs" tone="amber" onClick={()=>go("maintenance")}/><Stat label="Safety actions" value={safetyCounts["Action required"]+safetyCounts.Expired+safetyCounts["Under review"]} note="Outstanding compliance items" tone="blue" onClick={()=>go("golden")}/></>}</section>
 {isManager&&<div className="overview-chart-grid">
   <DashboardChart title="Health & Safety" subtitle="Current compliance position" rows={[
    {label:"Current",value:safetyCounts.Current},
    {label:"Action required",value:safetyCounts["Action required"]},
    {label:"Under review",value:safetyCounts["Under review"]},
    {label:"Expired",value:safetyCounts.Expired}
   ]}/>
   <DashboardChart title="Work orders" subtitle="Operational workload" rows={[
    {label:"Open",value:woCounts.Open},
    {label:"In progress",value:woCounts["In progress"]},
    {label:"On hold",value:woCounts["On hold"]},
    {label:"Complete",value:woCounts.Complete}
   ]}/>
   <DashboardChart title="Payments" subtitle="Completed WO payment position" rows={[
    {label:"Awaiting approval",value:paymentCounts.Awaiting},
    {label:"Approved",value:paymentCounts.Approved},
    {label:"Paid",value:paymentCounts.Paid}
   ]}/>
 </div>}
 {isManager&&managerRows.length>0&&<section className="panel manager-overview-panel"><div className="panel-head"><div><p className="eyebrow">PORTFOLIO MANAGERS</p><h2>Performance overview</h2></div></div><div className="manager-overview-grid">{managerRows.map(row=><article key={row.name} className="manager-overview-card"><div className="manager-overview-head"><div><span>Portfolio manager</span><h3>{row.name}</h3></div><strong>{row.blocks} blocks</strong></div><div className="manager-metric"><span>Compliance</span><b>{row.compliance}%</b><div><i style={{width:`${row.compliance}%`}}/></div></div><dl><div><dt>Outstanding safety</dt><dd>{row.outstandingSafety}</dd></div><div><dt>Open WOs</dt><dd>{row.openWOs}</dd></div><div><dt>Awaiting payment</dt><dd>{row.awaitingPayment}</dd></div></dl></article>)}</div></section>}
 {isManager?<div className="overview-pie-grid">
  <PieSummary title="Compliance" subtitle="Health & Safety position" segments={[
    {label:"Current",value:safetyCounts.Current,tone:"green"},
    {label:"Outstanding",value:safetyCounts["Action required"]+safetyCounts["Under review"]+safetyCounts.Expired,tone:"amber"}
  ]} emptyLabel="No compliance records yet" onClick={()=>go("golden")}/>
  <PieSummary unitLabel="GBP" title="Service charges" subtitle="Outstanding balances (£)" segments={[{label:"Overdue",value:arrears/100,tone:"amber"},{label:"Not overdue",value:(outstanding-arrears)/100,tone:"green"}]} emptyLabel={serviceCharges.length?"No outstanding balance":"No service charge records yet"} onClick={()=>go("finance")}/>
  <PieSummary title="Contractor payments" subtitle="Completed work orders" segments={[
    {label:"Awaiting approval",value:paymentCounts.Awaiting,tone:"amber"},
    {label:"Approved",value:paymentCounts.Approved,tone:"blue"},
    {label:"Paid",value:paymentCounts.Paid,tone:"green"}
  ]} emptyLabel="No contractor payment data yet" onClick={()=>go("maintenance")}/>
 </div>:<div className="clean-overview-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">YOUR PORTFOLIO</p><h2>Blocks at a glance</h2></div><button onClick={()=>go("buildings")}>View blocks</button></div><div className="clean-block-preview">{blocks.slice(0,5).map(b=><button key={b.id} onClick={()=>go("buildings")}><b>{b.name}</b><span>{b.address.replace(/\n/g,", ")}</span><strong>{b.units} units</strong></button>)}</div></section></div>}</>
}
function PieSummary({title,subtitle,segments,emptyLabel,onClick,unitLabel="records"}:{unitLabel?:string;title:string;subtitle:string;segments:{label:string;value:number;tone:"green"|"amber"|"blue"|"red"}[];emptyLabel:string;onClick?:()=>void}){
 const total=segments.reduce((sum,s)=>sum+s.value,0);
 let offset=0;
 const toneColor:{[key:string]:string}={green:"#5f7d67",amber:"#c99a2e",blue:"#6e665b",red:"#a94d46"};
 const gradient=total?segments.filter(s=>s.value>0).map(s=>{const start=(offset/total)*100;offset+=s.value;const end=(offset/total)*100;return `${toneColor[s.tone]} ${start}% ${end}%`;}).join(", "):"#ece6da 0 100%";
 return <section className={`panel overview-pie-card ${onClick?"clickable":""}`} onClick={onClick} role={onClick?"button":undefined} tabIndex={onClick?0:undefined} onKeyDown={e=>{if(onClick&&(e.key==="Enter"||e.key===" ")){e.preventDefault();onClick();}}}>
  <div className="panel-head"><div><p className="eyebrow">{title.toUpperCase()}</p><h2>{subtitle}</h2></div></div>
  <div className="pie-summary-body"><div className="pie-ring" style={{background:`conic-gradient(${gradient})`}}><div><strong>{unitLabel==="GBP"?total.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2}):total}</strong><span>{total?unitLabel:"No data"}</span></div></div>
  <div className="pie-legend">{total?segments.map(s=><div key={s.label}><i className={`pie-dot ${s.tone}`}/><span>{s.label}</span><strong>{unitLabel==="GBP"?s.value.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2}):s.value}</strong></div>):<p>{emptyLabel}</p>}</div></div>
 </section>
}
function DashboardChart({title,subtitle,rows}:{title:string;subtitle:string;rows:{label:string;value:number}[]}){
 const max=Math.max(1,...rows.map(r=>r.value));
 const total=rows.reduce((sum,r)=>sum+r.value,0);
 return <section className="panel dashboard-chart"><div className="panel-head"><div><p className="eyebrow">{title.toUpperCase()}</p><h2>{subtitle}</h2></div><strong>{total}</strong></div><div className="dashboard-bars">{rows.map(row=><div key={row.label} className="dashboard-bar-row"><div><span>{row.label}</span><b>{row.value}</b></div><div className="dashboard-bar-track"><i style={{width:`${Math.max(row.value?8:0,(row.value/max)*100)}%`}}/></div></div>)}</div></section>
}
function Stat({label,value,note,tone,onClick}:{label:string;value:number|string;note:string;tone:string;onClick?:()=>void}){return <article className={`stat ${tone} ${onClick?"clickable":""}`} onClick={onClick} onKeyDown={e=>{if(onClick&&(e.key==="Enter"||e.key===" ")){e.preventDefault();onClick();}}} role={onClick?"button":undefined} tabIndex={onClick?0:undefined}><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div><i>▦</i></article>}
function BuildingSafety({blocks}:{blocks:Block[]}){const[building,setBuilding]=useState(blocks[0]?.name ?? ""),selected=blocks.find(x=>x.name===building);return <><div className="page-head"><div><p className="eyebrow">HEALTH & SAFETY</p><h1>Golden Thread</h1><p>Choose a block to view its safety record.</p></div></div>{selected && <div className="building-context"><label>Building<select value={building} onChange={e=>setBuilding(e.target.value)}>{blocks.map(x=><option key={x.id}>{x.name}</option>)}</select></label><div><span>{selected?.units ?? 0} units</span><small>{selected?.address.replace(/\n/g,", ")}</small></div></div>}<div className="clean-notice">No safety records have been added for {selected?.name ?? "this portfolio"}. Compliance scores and statuses will appear only when supported by actual records.</div><div className="safety-empty-grid">{headings.map(x=><article className="panel" key={x}><span>▰</span><h2>{x}</h2><p>No records added</p></article>)}</div></>}
function ResidentRegister({blocks,units,residents:allResidents}:{blocks:Block[];units:Unit[];residents:Resident[]}){
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
 return <><div className="page-head"><div><p className="eyebrow">RESIDENT MANAGEMENT</p><h1>Residents & leaseholders</h1><p>Live resident records are kept separate by block and unit.</p></div></div>
 <section className="stat-grid three"><Stat label="Residents" value={residents.length} note="Live Supabase records" tone="blue"/><Stat label="Blocks with residents" value={new Set(residents.map(r=>r.blockId)).size} note="Blocks remain independent" tone="green"/><Stat label="Assigned units" value={new Set(residents.map(r=>r.unitId)).size} note="Resident-linked units" tone="amber"/></section>
 <nav className="tenant-tabs"><button className={!archived?"active":""} onClick={()=>setArchived(false)}>Current residents</button><button className={archived?"active":""} onClick={()=>setArchived(true)}>Archive</button></nav><div className="resident-toolbar"><label>Block<select value={selectedBlock} onChange={e=>setSelectedBlock(e.target.value==="all"?"all":Number(e.target.value))}><option value="all">All blocks with residents</option>{blocks.map(block=><option key={block.id} value={block.id}>{block.name}</option>)}</select></label><label>Find resident<input value={residentQuery} onChange={e=>setResidentQuery(e.target.value)} placeholder="Name, email, phone or unit…"/></label></div>
 {groupedBlocks.length===0?<div className="feature-panel"><span>◎</span><h2>No matching residents</h2><p>{residents.length===0?"No resident records have been added yet.":"No resident matches the selected block or search."}</p></div>:<div className="resident-blocks">{groupedBlocks.map(block=>{const blockResidents=matchingResidents.filter(resident=>resident.blockId===block.id);return <section className="panel resident-block-panel" key={block.id}><div className="resident-block-head"><div><p className="eyebrow">BLOCK</p><h2>{block.name}</h2><span>{block.address.replace(/\n/g,", ")}</span></div><strong>{blockResidents.length} {blockResidents.length===1?"resident":"residents"}</strong></div><div className="resident-live-head"><span>Resident</span><span>Unit</span><span>Contact</span></div>{blockResidents.map(resident=>{const unit=unitById.get(resident.unitId);const initials=resident.fullName.split(" ").filter(Boolean).map(part=>part[0]).slice(0,2).join("").toUpperCase();return <article className="resident-live-row" key={resident.id}><span className="resident-avatar-live">{initials}</span><div><b>{resident.fullName}</b><small>{resident.email}</small></div><div><span>Unit</span><b>{unit?.unitNumber??"Unassigned"}</b></div><div><span>Phone</span><b>{resident.phone||"Not provided"}</b></div><ResidentArchiveAction resident={resident}/></article>})}</section>})}</div>}</>
}
function EmptyModule({title,description}:{title:string;description:string}){return <><div className="page-head"><div><p className="eyebrow">MANAGEMENT</p><h1>{title}</h1></div></div><div className="feature-panel"><span>◇</span><h2>No records yet</h2><p>{description}</p></div></>}
