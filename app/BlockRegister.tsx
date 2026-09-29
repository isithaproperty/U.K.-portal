"use client";

import { useState } from "react";
import type {Block,Unit,Resident} from "./types";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });


export default function BlockRegister({ globalQuery = "", blocks, ownUnits = [], onOpen }: { globalQuery?: string; blocks: Block[]; ownUnits?: Unit[]; onOpen?: (id:number)=>void }) {
  const managers = [...new Set(blocks.map((block) => block.manager))].sort();
  const types = [...new Set(blocks.map((block) => block.type))].sort();
  const blockCount = blocks.length;
  const unitCount = blocks.reduce((sum, block) => sum + block.units, 0);
  const [query, setQuery] = useState("");
  const [manager, setManager] = useState("");
  const [type, setType] = useState("");
  const terms = [globalQuery, query].map((term) => term.trim().toLocaleLowerCase()).filter(Boolean);
  const filtered = blocks.filter((block) => {
    const fields = [block.name, block.managementCompany, block.address, block.manager, block.type];
    const matchesSearch = terms.every((term) => fields.some((value) => value.toLocaleLowerCase().includes(term)));
    return matchesSearch && (!manager || block.manager === manager) && (!type || block.type === type);
  });

  return <section className="block-register">
    <div className="page-head"><div><p className="eyebrow">PROPERTY REGISTER</p><h1>Block list</h1><p>Imported from the block report dated 28 September 2026.</p></div></div>
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
    </div>
  </section>;
}
