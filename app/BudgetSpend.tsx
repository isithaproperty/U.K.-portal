"use client";
import {useEffect,useRef,useState} from 'react';
import type {Block} from './types';
import {budgetSpendCategories,buildBudgetSpend,validateBudgetSpendState,type BudgetSpendState,type SpendCategory} from '../lib/budget-spend';
import type {BuildingStatementInput} from '../lib/building-statement';
import {planningPeriods} from '../lib/financial-planning';
import {money} from '../lib/service-charges';
type Loaded={input:BuildingStatementInput;categories:SpendCategory[];state:BudgetSpendState;revision:number;generated:string};
export default function BudgetSpend({blocks}:{blocks:Block[]}){
 const [blockId,setBlockId]=useState(0),[loaded,setLoaded]=useState<Loaded|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const version=useRef(0),lock=useRef(false);
 useEffect(()=>()=>{version.current++;},[]);
 async function get(url:string){const response=await fetch(url,{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load complete report.');return data;}
 async function load(){if(!blockId||lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');setLoaded(null);const request=++version.current;
  try{
   const financial=await get(`/api/blocks/${blockId}/management-review/financials`);
   const budget=budgetSpendCategories(financial.state,blockId),period=planningPeriods(budget.yearStart,'Annual')[0];
   const [data,saved]=await Promise.all([get(`/api/blocks/${blockId}/statement?start=${period.start}&end=${period.end}`),get(`/api/blocks/${blockId}/management-review/budget-spend`)]);
   const latestFinancial=await get(`/api/blocks/${blockId}/management-review/financials`);
   if(latestFinancial.revision!==financial.revision)throw Error('The budget changed while loading. Reload to compare the latest saved budget.');
   if(request!==version.current)return;
   const state=saved.state?validateBudgetSpendState(saved.state,blockId,data.workOrders):{version:1 as const,blockId,yearStart:budget.yearStart,assignments:[]};
   const compatible=state.yearStart===budget.yearStart;
   if(!compatible)setMessage('The saved budget year changed. Review and save category assignments for the new year. Previous revisions remain in the audit history.');
   const categories=new Set(budget.categories.map(c=>c.id));
   const valid=compatible?state.assignments.filter(a=>categories.has(a.categoryId)):[];
   if(valid.length!==state.assignments.length)setMessage('The budget year or categories changed. Check unallocated work orders and save the reviewed assignments.');
   setLoaded({input:{...data,blockId,start:period.start,end:period.end},categories:budget.categories,state:{...state,yearStart:budget.yearStart,assignments:valid},revision:saved.revision,generated:data.asOfGeneratedAt});setDirty(!compatible||valid.length!==state.assignments.length);
  }catch(e){if(request===version.current)setError(e instanceof Error?e.message:'Could not load report.');}finally{lock.current=false;setBusy(false);}
 }
 async function save(){if(!loaded||lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');const request=version.current;
  try{const response=await fetch(`/api/blocks/${blockId}/management-review/budget-spend`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:loaded.state,revision:loaded.revision})});const result=await response.json();if(!response.ok)throw Error(result.error||'Save not confirmed. Reload before retrying.');if(request!==version.current)return;setLoaded({...loaded,revision:result.revision});setDirty(false);setMessage('Work-order category assignments saved. No invoices or payments were created.');}
  catch(e){if(request===version.current)setError(e instanceof Error?e.message:'Save not confirmed. Reload before retrying.');}finally{lock.current=false;setBusy(false);}
 }
 let report:ReturnType<typeof buildBudgetSpend>|null=null,reportError='';
 if(loaded){try{report=buildBudgetSpend(loaded.input,loaded.categories,loaded.state);}catch(e){reportError=e instanceof Error?e.message:'Report failed validation.';}}
 return <section className="panel"><h2>Budget vs spend</h2><p>Compare the saved annual budget with dated supplier invoices. Work-order estimates, annual approvals and payment drafts are not spending. Verified payments are shown separately by payment date, including payments of earlier invoices.</p>
 <label>Building<select value={blockId} disabled={busy} onChange={e=>{version.current++;setBlockId(Number(e.target.value));setLoaded(null);setDirty(false);setError('');setMessage('');}}><option value={0}>Choose a building</option>{blocks.map(block=><option key={block.id} value={block.id}>{block.name}</option>)}</select></label><button type="button" disabled={busy||!blockId} onClick={()=>void load()}>{busy?'Working…':'Load saved budget and spending'}</button>
 {(error||reportError)&&<p role="alert">{error||reportError}</p>}{message&&<p role="status">{message}</p>}
 {loaded&&<><p>Budget year {loaded.input.start} to {loaded.input.end}. Snapshot: {loaded.generated}. Reload for later invoices or payments. Future months are not a forecast.</p><h3>Allocate work orders to budget categories</h3><p>Each work order has one category for this budget year. Its monthly invoices follow that allocation, including orders raised in an earlier year. Unallocated spending remains visible below. {dirty?'Assignments have unsaved changes.':''}</p>
 <div className="block-table-wrap"><table><thead><tr><th>Work order</th><th>Description</th><th>Status</th><th>Budget category</th></tr></thead><tbody>{loaded.input.workOrders.map(order=><tr key={order.id}><td>{order.workOrderNumber}</td><td>{order.title}</td><td>{order.status}</td><td><select aria-label={`Budget category for ${order.workOrderNumber}`} disabled={busy} value={loaded.state.assignments.find(a=>a.workOrderId===order.id)?.categoryId??''} onChange={e=>{const categoryId=e.target.value;setLoaded({...loaded,state:{...loaded.state,assignments:[...loaded.state.assignments.filter(a=>a.workOrderId!==order.id),...(categoryId?[{workOrderId:order.id,categoryId}]:[])]}});setDirty(true);setMessage('');}}><option value="">Unallocated</option>{loaded.categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></td></tr>)}</tbody></table></div><button type="button" disabled={busy||!dirty} onClick={()=>void save()}>Save reviewed assignments</button>
 {report&&<><h3>Annual comparison</h3><p>{dirty?'Preview uses unsaved category assignments. ':''}Remaining budget is budget minus invoiced spending, not cash in the bank. Negative amounts mean over budget. Until year end these are recorded totals, not a final year-end forecast.</p>{report.warnings.map(w=><p role="alert" key={w}>{w}</p>)}<div className="block-table-wrap"><table><thead><tr><th>Category</th><th>Annual budget</th><th>Invoiced spend</th><th>Remaining budget</th><th>Verified payments in year</th></tr></thead><tbody>{report.rows.map(row=><tr key={row.id}><td>{row.name}</td><td>{money(row.budgetPence)}</td><td>{money(row.invoicedPence)}</td><td>{money(row.remainingPence)}</td><td>{money(row.paidPence)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><td>{money(report.total.budgetPence)}</td><td>{money(report.total.invoicedPence)}</td><td>{money(report.total.remainingPence)}</td><td>{money(report.total.paidPence)}</td></tr></tfoot></table></div><h3>Monthly spending</h3><div className="block-table-wrap"><table><thead><tr><th>Month</th><th>Invoices</th><th>Running spend</th><th>Verified payments</th></tr></thead><tbody>{report.monthly.map(row=><tr key={row.month}><td>{row.month}</td><td>{money(row.invoicedPence)}</td><td>{money(row.runningSpendPence)}</td><td>{money(row.paidPence)}</td></tr>)}</tbody></table></div></>}
 </>}
 </section>;
}
