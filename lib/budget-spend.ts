import {planningPeriods, validPlanningDate} from './financial-planning.ts';
import {validateRecipientBudgets} from './recipient-budget.ts';
import {buildBuildingStatement, type BuildingStatementInput} from './building-statement.ts';
import type {WorkOrder} from '../app/types';

export type SpendCategory={id:string;name:string;budgetPence:number};
export type BudgetSpendState={version:1;blockId:number;yearStart:string;assignments:{workOrderId:number;categoryId:string}[]};
export function budgetSpendCategories(value:unknown,blockId:number):{yearStart:string;categories:SpendCategory[]}{
 const state=value as {blockId:number;yearStart:string;kind:string;schedules:{id:string;name:string;amount:string}[];recipientBudgets:unknown};
 if(!state||state.blockId!==blockId||state.kind!=='Demand'||!validPlanningDate(state.yearStart)||!Array.isArray(state.schedules))throw Error('Save and review this building’s annual budget first.');
 const summaries=validateRecipientBudgets(state.recipientBudgets,blockId,state.yearStart,state.schedules);
 if(!summaries.length||summaries.length!==state.schedules.length)throw Error('Each saved schedule needs reviewed budget categories. Import and save its budget first.');
 return {yearStart:state.yearStart,categories:summaries.flatMap(summary=>summary.categories.map(category=>({id:JSON.stringify([summary.scheduleId,category.name]),name:summaries.length>1?`${state.schedules.find(s=>s.id===summary.scheduleId)!.name}: ${category.name}`:category.name,budgetPence:category.amountPence})))};
}
export function validateBudgetSpendState(value:unknown,blockId:number,orders:WorkOrder[]):BudgetSpendState{
 const state=value as BudgetSpendState;
 if(!state||state.version!==1||state.blockId!==blockId||!validPlanningDate(state.yearStart)||!Array.isArray(state.assignments)||state.assignments.length>10000)throw Error('Invalid budget category assignments.');
 const allowed=new Set(orders.filter(order=>order.blockId===blockId).map(order=>order.id)),seen=new Set<number>();
 const assignments=state.assignments.map(item=>{
  if(!item||!Number.isSafeInteger(item.workOrderId)||!allowed.has(item.workOrderId)||seen.has(item.workOrderId)||typeof item.categoryId!=='string'||!item.categoryId.trim()||item.categoryId.length>600)throw Error('Choose each building work order once and a valid budget category.');
  seen.add(item.workOrderId);return {workOrderId:item.workOrderId,categoryId:item.categoryId};
 });
 return {version:1,blockId,yearStart:state.yearStart,assignments};
}
export function buildBudgetSpend(input:BuildingStatementInput,categories:SpendCategory[],raw:BudgetSpendState){
 const state=validateBudgetSpendState(raw,input.blockId,input.workOrders),{start,end}=planningPeriods(state.yearStart,'Annual')[0];
 if(input.start!==start||input.end!==end)throw Error('Report dates must match the saved budget year.');
 const ids=new Set(categories.map(c=>c.id));
 if(ids.size!==categories.length||!categories.length||categories.some(c=>!c.id||!c.name||!Number.isSafeInteger(c.budgetPence)||c.budgetPence<0))throw Error('Invalid budget categories.');
 if(state.assignments.some(a=>!ids.has(a.categoryId)))throw Error('A saved category no longer matches the budget. Review the work-order assignments.');
 const assignments=new Map(state.assignments.map(a=>[a.workOrderId,a.categoryId]));
 const rows=[...categories,{id:'',name:'Unallocated work orders',budgetPence:0}].map(c=>({...c,invoicedPence:0,paidPence:0,remainingPence:c.budgetPence}));
 const byId=new Map(rows.map(row=>[row.id,row]));
 const before=new Date(`${start}T12:00:00Z`);before.setUTCDate(before.getUTCDate()-1);const beforeDate=before.toISOString().slice(0,10);
 const original=buildBuildingStatement({...input,start:beforeDate,end:beforeDate});
 let previous=new Map(original.invoices.map(invoice=>[invoice.id,invoice.paidPence]));
 const warnings=new Set(original.warnings);
 const monthly:{month:string;invoicedPence:number;paidPence:number;runningSpendPence:number}[]=[];
 let cursor=start,running=0;
 while(cursor<=end){
  const month=cursor.slice(0,7),date=new Date(`${cursor}T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+1,0);const monthEnd=date.toISOString().slice(0,10)<end?date.toISOString().slice(0,10):end;
  const statement=buildBuildingStatement({...input,start:cursor,end:monthEnd});statement.warnings.forEach(w=>warnings.add(w));
  let invoicedPence=0,paidPence=0;
  for(const invoice of statement.invoices){
   const row=byId.get(assignments.get(invoice.workOrderId)??'')!;
   if(invoice.inPeriod){row.invoicedPence+=invoice.amountPence;invoicedPence+=invoice.amountPence;}
   const paid=invoice.paidPence-(previous.get(invoice.id)??0);row.paidPence+=paid;paidPence+=paid;
  }
  previous=new Map(statement.invoices.map(invoice=>[invoice.id,invoice.paidPence]));running+=invoicedPence;
  monthly.push({month,invoicedPence,paidPence,runningSpendPence:running});
  const next=new Date(`${monthEnd}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);cursor=next.toISOString().slice(0,10);
 }
 rows.forEach(row=>{row.remainingPence=row.budgetPence-row.invoicedPence;});
 const total={budgetPence:rows.reduce((s,r)=>s+r.budgetPence,0),invoicedPence:running,paidPence:monthly.reduce((s,r)=>s+r.paidPence,0),remainingPence:rows.reduce((s,r)=>s+r.remainingPence,0)};
 if(Object.values(total).some(n=>!Number.isSafeInteger(n)))throw Error('Report totals exceed supported accounting precision.');
 return {start,end,rows,monthly,total,warnings:[...warnings]};
}
