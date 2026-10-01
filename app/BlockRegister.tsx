"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/browser";
import type {Block,Unit,Resident} from "./types";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });


export default function BlockRegister({ globalQuery = "", blocks, ownUnits = [], onOpen }: { globalQuery?: string; blocks: Block[]; ownUnits?: Unit[]; onOpen?: (id:number)=>void }) {
  const router = useRouter();
  const managers = [...new Set(blocks.map((block) => block.manager))].sort();
  const types = [...new Set(blocks.map((block) => block.type))].sort();
  const blockCount = blocks.length;
  const unitCount = blocks.reduce((sum, block) => sum + block.units, 0);
  const [query, setQuery] = useState("");
  const [manager, setManager] = useState("");
  const [type, setType] = useState("");
  const [tab,setTab]=useState<"list"|"onboard">("list");
  const [newName,setNewName]=useState(""),[newAddress,setNewAddress]=useState(""),[newCompany,setNewCompany]=useState(""),[newType,setNewType]=useState(types[0]||"Residential"),[newUnits,setNewUnits]=useState(""),[newManager,setNewManager]=useState(managers[0]||""),[newYearEnd,setNewYearEnd]=useState(""),[saving,setSaving]=useState(false),[message,setMessage]=useState("");
  const terms = [globalQuery, query].map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);

  async function onboardBlock(event:React.FormEvent){
    event.preventDefault();setSaving(true);setMessage("");
    const unitsValue=Number(newUnits);
    if(!newName.trim()||!newAddress.trim()||!newCompany.trim()||!newType.trim()||!newManager.trim()||!newYearEnd||!Number.isFinite(unitsValue)||unitsValue<0){
      setMessage("Complete all required block details.");setSaving(false);return;
    }
    const supabase=createClient();
    const {data,error}=await supabase.from("blocks").insert({
      name:newName.trim(),
      management_company:newCompany.trim(),
      type:newType.trim(),
      address:newAddress.trim(),
      units:unitsValue,
      manager:newManager.trim(),
      financial_year_end:newYearEnd
    }).select("id").single();
    if(error){setMessage("Block could not be created: "+error.message);setSaving(false);return;}
    setNewName("");setNewAddress("");setNewCompany("");setNewType(types[0]||"Residential");setNewUnits("");setNewManager(managers[0]||"");setNewYearEnd("");
    setMessage("New block onboarded successfully.");setSaving(false);router.refresh();
    if(data?.id)onOpen?.(data.id);
  }

  const filtered = blocks.filter((block) => {
    const fields = [block.name, block.managementCompany, block.address, block.manager, block.type];
    const matchesSearch = terms.every((term) => fields.some((value) => value.toLocaleLowerCase().includes(term)));
    return matchesSearch && (!manager || block.manager === manager) && (!type || block.type === type);
  });

  return <section className="block-register">
    <div className="page-head"><div><p className="eyebrow">PROPERTY REGISTER</p><h1>Buildings</h1><p>Manage the live portfolio and onboard new blocks.</p></div></div>
    <div className="building-subtabs"><button className={tab==="list"?"active":""} onClick={()=>setTab("list")}>Block list</button><button className={tab==="onboard"?"active":""} onClick={()=>setTab("onboard")}>Onboard new block</button></div>
    {tab==="list"&&<>
    <div className="block-summary"><div><strong>{blockCount}</strong><span>Blocks</span></div><div><strong>{unitCount}</strong><span>Units</span></div><div><strong>{filtered.length}</strong><span>Showing</span></div></div>
    <div className="block-panel">
      <div className="block-filters">
        <label>Find a block<input type="search" placeholder="Name, address or company" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Manager<select value={manager} onChange={(event) => setManager(event.target.value)}><option value="">All managers</option>{managers.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Type<select value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option>{types.map((name) => <option key={name}>{name}</option>)}</select></label>
      </div>
      <div className="block-table-wrap"><table className="block-table"><thead><tr><th>Block</th><th>Management company</th><th>Type</th><th>Units</th><th>Manager</th><th>Year end</th></tr></thead><tbody>
        {filtered.map((block) => <tr key={block.id} onClick={() => onOpen?.(block.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen?.(block.id); }} tabIndex={0} aria-label={`View ${block.name}`}>
          <td><strong>{block.name}</strong><small>{block.address.replace(/\n/g, ", ")}</small></td><td>{block.managementCompany}</td><td>{block.type}</td><td className="numeric">{block.units}</td><td>{block.manager}</td><td>{dateFormat.format(new Date(`${block.financialYearEnd}T00:00:00Z`))}</td>
        </tr>)}
      </tbody></table></div>
      {filtered.length === 0 && <p className="block-empty">No blocks match those filters.</p>}
    </div></>}
    {tab==="onboard"&&<section className="panel block-onboard-panel"><div className="panel-head"><div><p className="eyebrow">NEW BUILDING</p><h2>Onboard new block</h2><p>Create the block first. Units, residents, health and safety and service-charge information can then be added to its dedicated dashboard.</p></div></div><form onSubmit={onboardBlock} className="block-onboard-form"><div className="block-onboard-grid"><label>Block name<input required value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. 120 Example Road"/></label><label>Management company<input required value={newCompany} onChange={e=>setNewCompany(e.target.value)} placeholder="Management company"/></label><label>Property type<input required value={newType} onChange={e=>setNewType(e.target.value)} placeholder="Residential"/></label><label>Number of units<input required type="number" min="0" value={newUnits} onChange={e=>setNewUnits(e.target.value)} placeholder="0"/></label><label>Portfolio manager<input required list="block-manager-options" value={newManager} onChange={e=>setNewManager(e.target.value)} placeholder="Manager name"/><datalist id="block-manager-options">{managers.map(name=><option key={name} value={name}/>)}</datalist></label><label>Financial year end<input required type="date" value={newYearEnd} onChange={e=>setNewYearEnd(e.target.value)}/></label></div><label>Full block address<textarea required rows={4} value={newAddress} onChange={e=>setNewAddress(e.target.value)} placeholder="Full postal address"/></label><div className="block-onboard-actions"><button className="primary" disabled={saving}>{saving?"Creating block…":"Create block"}</button></div></form></section>}
    {message&&<p className="unit-message" role="status">{message}</p>}
  </section>;
}
