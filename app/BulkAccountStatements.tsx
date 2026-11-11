"use client";
import {useEffect,useRef,useState} from "react";
import type {Block,Unit} from "./types";
import {money,type ChargeEntry} from "../lib/service-charges";
import {buildBulkAccountStatements,type AccountScope,type BulkStatements} from "../lib/bulk-account-statements";
type Props={block:Block;units:Unit[];entries:ChargeEntry[];today:string;reviewOnly:boolean};
export default function BulkAccountStatements({block,units,entries,today,reviewOnly}:Props){
 const [start,setStart]=useState(`${today.slice(0,4)}-01-01`),[end,setEnd]=useState(today),[scope,setScope]=useState<AccountScope>("debt");
 const [result,setResult]=useState<BulkStatements|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[reviewed,setReviewed]=useState(false);
 const request=useRef<{token:number;controller:AbortController|null}>({token:0,controller:null});
 function invalidate(){request.current.token++;request.current.controller?.abort();request.current.controller=null;setResult(null);setBusy(false);setReviewed(false);setError("");}
 useEffect(()=>{invalidate();return()=>{request.current.token++;request.current.controller?.abort();};},[block,units,entries,today,reviewOnly]);
 async function preview(){
  if(request.current.controller)return;
  const controller=new AbortController(),token=++request.current.token;request.current.controller=controller;
  setBusy(true);setResult(null);setReviewed(false);setError("");
  try{
   // Validate dates before requesting anything. Full snapshot validation follows the request.
   buildBulkAccountStatements({block,units:[],entries:[],start,end,today,scope,generatedAt:new Date().toISOString()});
   let snapshot={units:units.filter(u=>u.blockId===block.id),entries:entries.filter(e=>e.block_id===block.id),asOfGeneratedAt:new Date().toISOString()};
   if(!reviewOnly){const response=await fetch(`/api/blocks/${block.id}/statement?${new URLSearchParams({start,end})}`,{cache:"no-store",signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||"Could not load the complete building ledger.");snapshot=data;}
   const next=buildBulkAccountStatements({block,units:snapshot.units,entries:snapshot.entries,start,end,today,scope,generatedAt:snapshot.asOfGeneratedAt,synthetic:reviewOnly});
   if(token===request.current.token&&!controller.signal.aborted)setResult(next);
  }catch(cause){if(token===request.current.token&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Could not prepare account statements.");}
  finally{if(token===request.current.token){setBusy(false);request.current.controller=null;}}
 }
 function download(){
  if(!result||!reviewed||busy||result.blockId!==block.id||result.start!==start||result.end!==end||result.scope!==scope)return;
  const url=URL.createObjectURL(new Blob([result.html],{type:"text/html;charset=utf-8"})),link=document.createElement("a");
  link.href=url;link.download=`manager-only-${reviewOnly?"synthetic-":""}account-statements-${block.id}-${start}-${end}-${scope}.html`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className="panel tenant-card tenant-form"><h2>Pull all account statements</h2><p>Selected building only: <strong>{block.name}</strong>. One combined manager-only HTML file, with each unit starting on a new printed page. Open the downloaded file and use Print / Save as PDF. Do not send the combined file to an individual resident.</p><p>{reviewOnly?"Synthetic preview only. No server requests are made.":"Preview refreshes the complete recorded unit register and ledger for this building. No payments, emails or saved ledger changes are made."}</p>
  <label>Statement opening date<input type="date" value={start} max={end} onChange={e=>{invalidate();setStart(e.target.value);}}/></label>
  <label>Statement end / as-of date<input type="date" value={end} min={start} max={today} onChange={e=>{invalidate();setEnd(e.target.value);}}/></label>
  <label>Accounts to include<select value={scope} onChange={e=>{invalidate();setScope(e.target.value as AccountScope);}}><option value="debt">Positive-balance accounts (including amounts not yet due)</option><option value="all">All unit accounts (including zero and credit balances)</option></select></label>
  <button className="unit-secondary" disabled={busy} onClick={()=>void preview()}>{busy?"Refreshing complete building ledger…":"Preview all statements"}</button>
  {(busy||result)&&<button className="unit-secondary" onClick={invalidate}>{busy?"Cancel":"Close preview"}</button>}
  {error&&<p role="alert">{error}</p>}
  {result&&<><p role="status">{result.accounts.length} account statements · {result.start} to {result.end} · retrieved {result.generatedAt}. {result.accounts.length===0?"No accounts match the selected scope. Nothing to download.":"Review the account list and document before downloading."}</p>
   {result.accounts.length>0&&<><div className="block-table-wrap"><table><caption>Included accounts · {block.name}</caption><thead><tr><th>Unit</th><th>Closing balance</th><th>Due</th><th>Overdue</th></tr></thead><tbody>{result.accounts.map(account=><tr key={account.unitId}><td>{account.unitNumber}</td><td>{money(account.balance)}</td><td>{money(account.due)}</td><td>{money(account.overdue)}</td></tr>)}</tbody></table></div><iframe sandbox="" title="Manager-only combined account statement preview" srcDoc={result.html} style={{width:"100%",height:650,border:"1px solid #ccc"}}/><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I reviewed this snapshot and understand the combined file is manager-only and must not be sent to an individual resident.</label><button className="primary" disabled={!reviewed||busy} onClick={download}>Download all statements · HTML / print to PDF</button><p>Snapshot only. Refresh the preview after any new payments or ledger changes. These are account statements, not chaser letters or payment demands.</p></>}
  </>}
 </section>;
}
