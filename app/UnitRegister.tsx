"use client";

import ResidentArchiveAction from "./ResidentArchiveAction";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Block, Resident, Unit } from "./types";

const template = "unit_number,resident_name,resident_email,phone,payment_reference\n";

export default function UnitRegister({ blocks, units, residents, initialBlockId }: {
  blocks: Block[]; units: Unit[]; residents: Resident[]; initialBlockId: number | null;
}) {
  const router = useRouter();
  const [blockId, setBlockId] = useState(initialBlockId ?? blocks[0]?.id ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [unitNumber, setUnitNumber] = useState("");
  const [residentName, setResidentName] = useState("");
  const [residentEmail, setResidentEmail] = useState("");
  const [paymentReference,setPaymentReference]=useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [archived,setArchived]=useState(false);
 const selected = blocks.find(block => block.id === blockId);
  const visibleUnits = useMemo(() => units.filter(unit => unit.blockId === blockId), [units, blockId]);
  const byUnit = useMemo(() => {
    const map = new Map<number, Resident[]>();
    residents.filter(resident => resident.blockId === blockId && Boolean(resident.archivedAt)===archived).forEach(resident => map.set(resident.unitId, [...(map.get(resident.unitId) ?? []), resident]));
    return map;
  }, [residents, blockId,archived]);

  async function importRows(body: string, contentType: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/blocks/${blockId}/residents`, { method: "POST", headers: { "Content-Type": contentType }, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Import failed.");
      setMessage(`Saved ${result.imported} row${result.imported === 1 ? "" : "s"} to ${selected?.name ?? "this block"}.`);
      setFile(null); setUnitNumber(""); setResidentName(""); setResidentEmail(""); setPhone(""); setPaymentReference("");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "resident-import-template.csv"; link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="unit-register">
    <div className="page-head"><div><p className="eyebrow">BLOCK MANAGEMENT</p><h1>Units & residents</h1><p>Add units to a block, then assign residents by their sign-in email.</p></div></div>
    <section className="panel unit-select"><label>Choose block<select value={blockId} onChange={event => { setBlockId(Number(event.target.value)); setMessage(""); }}>{blocks.map(block => <option key={block.id} value={block.id}>{block.name}</option>)}</select></label><span>{visibleUnits.length} units entered · {residents.filter(row => row.blockId === blockId && Boolean(row.archivedAt)===archived).length} resident assignments</span></section>
    <div className="unit-grid">
      <section className="panel"><p className="eyebrow">ONE AT A TIME</p><h2>Add a unit or resident</h2><form onSubmit={event => { event.preventDefault(); void importRows(JSON.stringify({ rows: [{ unit_number: unitNumber, resident_name: residentName, resident_email: residentEmail, phone,payment_reference:paymentReference }] }), "application/json"); }}>
        <label>Unit number<input required maxLength={80} value={unitNumber} onChange={event => setUnitNumber(event.target.value)} placeholder="For example: Flat 1" /></label>
        <label>Resident name<input value={residentName} onChange={event => setResidentName(event.target.value)} placeholder="Leave blank for an empty unit" /></label>
        <label>Resident email<input type="email" value={residentEmail} onChange={event => setResidentEmail(event.target.value)} placeholder="Used for resident sign-in" /></label>
        <label>Fixed payment reference<input maxLength={80} value={paymentReference} onChange={event=>setPaymentReference(event.target.value)} placeholder="For example: 469/1104-01"/></label><label>Phone<input value={phone} onChange={event => setPhone(event.target.value)} /></label>
        <button className="primary" disabled={busy || !blockId}>Save unit</button>
      </form></section>
      <section className="panel"><p className="eyebrow">BULK IMPORT</p><h2>Upload resident list</h2><p>Download the CSV template and enter one row per unit and resident. Repeat a unit number to assign more than one resident. An empty resident name and email creates a unit without access. Add the fixed payment reference when assigning residents. Joint residents in a unit share its service charge account and reference. Blank references preserve existing references.</p><button type="button" className="unit-secondary" onClick={downloadTemplate}>Download CSV template</button><label>CSV file<input type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label><button className="primary" disabled={busy || !file || !blockId} onClick={() => file && void file.text().then(text => importRows(text, "text/csv"))}>Import to {selected?.name ?? "block"}</button><small>Up to 500 rows and 1 MB per import. Importing the same unit and email updates its details; it does not erase other residents.</small></section>
    </div>
    {message && <p className="unit-message" role="status">{message}</p>}
    <nav className="tenant-tabs"><button className={!archived?"active":""} onClick={()=>setArchived(false)}>Current residents</button><button className={archived?"active":""} onClick={()=>setArchived(true)}>Archive</button></nav><section className="panel unit-list"><div className="panel-head"><div><p className="eyebrow">{selected?.name.toUpperCase()}</p><h2>Unit register</h2></div></div>{visibleUnits.length ? <div className="block-table-wrap"><table className="block-table"><thead><tr><th>Unit</th><th>Resident</th><th>Email</th><th>Phone</th><th>Payment reference</th><th>Actions</th></tr></thead><tbody>{visibleUnits.flatMap(unit => {
      const people = byUnit.get(unit.id) ?? [];
      return people.length ? people.map(person => <tr key={person.id}><td>{unit.unitNumber}</td><td>{person.fullName}</td><td>{person.email}</td><td>{person.phone ?? "—"}</td><td>{unit.paymentReference??"Not added"}</td><td>{!person.archivedAt&&<a href={`/tenant?resident=${person.id}`}>Preview tenant portal</a>}<ResidentArchiveAction resident={person}/></td></tr>) : archived?[]:[<tr key={`unit-${unit.id}`}><td>{unit.unitNumber}</td><td>Unassigned</td><td>—</td><td>—</td><td>{unit.paymentReference??"Not added"}</td><td>—</td></tr>];
    })}</tbody></table></div> : <p>No units have been added to this block.</p>}</section>
  </section>;
}
