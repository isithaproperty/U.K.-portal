/** Recipient-safe category data only: no workbook bytes, invoice sheets or unit data. */
export type RecipientBudgetSummary={blockId:number;yearStart:string;scheduleId:string;categories:{name:string;amountPence:number}[];totalPence:number};
export function validateRecipientBudgets(value:unknown,blockId:number,yearStart:string,schedules:{id:string;amount:string}[]):RecipientBudgetSummary[]{
 if(!Array.isArray(value)||value.length>100)throw Error("Invalid recipient budget summaries.");
 const seen=new Set<string>();
 return value.map((item:RecipientBudgetSummary)=>{
  if(!item||item.blockId!==blockId||item.yearStart!==yearStart||typeof item.scheduleId!=="string"||seen.has(item.scheduleId))throw Error("Recipient budget must match this building, year and unique schedule.");
  seen.add(item.scheduleId);const schedule=schedules.find(s=>s.id===item.scheduleId);
  if(!schedule||!/^\d{1,7}(?:\.\d{1,2})?$/.test(schedule.amount)||!Array.isArray(item.categories)||!item.categories.length||item.categories.length>200)throw Error("Recipient budget categories are missing or no longer match the saved schedule.");
  const names=new Set<string>();const categories=item.categories.map(row=>{
   if(!row||typeof row.name!=="string"||!row.name.trim()||row.name.length>200||/[\x00-\x1f\x7f]/.test(row.name)||names.has(row.name.trim().toLowerCase())||!Number.isSafeInteger(row.amountPence)||row.amountPence<0||row.amountPence>999999999)throw Error("Invalid or duplicate recipient budget category.");
   names.add(row.name.trim().toLowerCase());return {name:row.name,amountPence:row.amountPence};
  });
  const total=categories.reduce((sum,row)=>sum+row.amountPence,0),[whole,fraction=""]=schedule.amount.split('.');
  if(total!==item.totalPence||total!==Number(whole)*100+Number(fraction.padEnd(2,'0'))||total<=0||total>999999999)throw Error("Recipient budget total differs from the saved schedule. Import and review it again.");
  return {blockId,yearStart,scheduleId:item.scheduleId,categories,totalPence:total};
 });
}
