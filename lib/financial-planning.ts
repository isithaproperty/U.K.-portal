/** Pure preparation helpers. These do not create ledger entries or deliver demands. */
export type DemandFrequency = "Annual" | "Half-yearly" | "Quarterly" | "English quarters";
export type LeaseShare = {unitId:number; percentage:string};
export type LeaseBudget = {id:string; name:string; annualPence:number; shares:LeaseShare[]};
export type DemandPeriod = {start:string; end:string};
export type FinancialDraftInput = {
 batchId:string; blockId:number; kind:"Demand"|"Surplus credit"; preparedDate:string;
 issueDate:string; dueDate:string; issueMode:"Issue now, future due date"|"Schedule for later";
 frequency:DemandFrequency; yearStart:string; periodIndex:number; schedules:LeaseBudget[];
};
export type FinancialDraftRow = {
 idempotencyKey:string; scheduleId:string; scheduleName:string; unitId:number;
 entryType:"Charge"|"Credit"; amountPence:number; preparedDate:string;
 plannedIssueDate:string; dueDate:string|null; chargePeriod:DemandPeriod|null;
};
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
export function validPlanningDate(value:string):boolean {
 if(!datePattern.test(value))return false;
 const date=new Date(`${value}T12:00:00Z`);
 return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
function requireDate(value:string){if(!validPlanningDate(value))throw new Error("Enter valid dates as YYYY-MM-DD.");}
function iso(date:Date){return date.toISOString().slice(0,10);}
function addDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return iso(date);}
function addMonths(value:string,months:number){
 const [year,month,day]=value.split("-").map(Number);
 const end=new Date(Date.UTC(year,month-1+months+1,0,12));
 return iso(new Date(Date.UTC(year,month-1+months,Math.min(day,end.getUTCDate()),12)));
}
export function planningPeriods(start:string,frequency:DemandFrequency):DemandPeriod[]{
 requireDate(start);
 if(!["Annual","Half-yearly","Quarterly","English quarters"].includes(frequency))throw new Error("Choose a demand frequency.");
 const count=frequency==="Annual"?1:frequency==="Half-yearly"?2:4;
 let boundaries:string[];
 if(frequency==="English quarters"){
  const quarterDays=["03-25","06-24","09-29","12-25"];
  const index=quarterDays.indexOf(start.slice(5));
  if(index<0)throw new Error("English quarters must begin on 25 March, 24 June, 29 September or 25 December, subject to the lease.");
  const year=Number(start.slice(0,4));
  boundaries=Array.from({length:5},(_,n)=>`${year+Math.floor((index+n)/4)}-${quarterDays[(index+n)%4]}`);
 }else boundaries=Array.from({length:count+1},(_,n)=>addMonths(start,n*(12/count)));
 return boundaries.slice(0,-1).map((date,index)=>({start:date,end:addDays(boundaries[index+1],-1)}));
}
export function parsePounds(value:string):number{
 if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(value))throw new Error("Enter a positive amount in pounds, with at most two decimal places.");
 const [pounds,pence=""]=value.split(".");
 const amount=Number(pounds)*100+Number(pence.padEnd(2,"0"));
 if(amount<=0||!Number.isSafeInteger(amount))throw new Error("Enter a positive amount.");
 return amount;
}
function shareWeight(value:string):number{
 if(!/^\d{1,3}(?:\.\d{1,4})?$/.test(value))throw new Error("Lease percentages need up to four decimal places.");
 const [whole,decimal=""]=value.split(".");
 const weight=Number(whole)*10000+Number(decimal.padEnd(4,"0"));
 if(weight<0||weight>1000000)throw new Error("Lease percentages must be between 0 and 100.");
 return weight;
}
/** Largest remainders allocates every penny, ties resolved by stable unit id. */
export function apportionLeaseBudget(totalPence:number,shares:LeaseShare[]):{unitId:number;amountPence:number}[]{
 if(!Number.isSafeInteger(totalPence)||totalPence<=0||totalPence>999999999)throw new Error("Budget must be a positive amount within £9,999,999.99.");
 if(!shares.length||shares.some(s=>!Number.isSafeInteger(s.unitId)||s.unitId<=0)||new Set(shares.map(s=>s.unitId)).size!==shares.length)throw new Error("Choose distinct valid units for each schedule.");
 const weighted=shares.map(s=>({...s,weight:shareWeight(s.percentage)}));
 if(weighted.reduce((sum,s)=>sum+s.weight,0)!==1000000)throw new Error("Lease percentages must total exactly 100% for each schedule.");
 const result=weighted.map(s=>({unitId:s.unitId,amountPence:Math.floor(totalPence*s.weight/1000000),remainder:(totalPence*s.weight)%1000000}));
 let remaining=totalPence-result.reduce((sum,s)=>sum+s.amountPence,0);
 for(const row of [...result].sort((a,b)=>b.remainder-a.remainder||a.unitId-b.unitId)){if(remaining--<=0)break;row.amountPence++;}
 return result.map(({unitId,amountPence})=>({unitId,amountPence}));
}
export function prepareFinancialDraft(input:FinancialDraftInput):FinancialDraftRow[]{
 const {batchId,blockId,kind,preparedDate,issueDate,dueDate,issueMode,frequency,yearStart,periodIndex,schedules}=input;
 if(!batchId.trim()||!Number.isSafeInteger(blockId)||blockId<=0)throw new Error("Select a block and a batch identifier.");
 if(!["Demand","Surplus credit"].includes(kind))throw new Error("Choose a batch type.");
 if(!["Issue now, future due date","Schedule for later"].includes(issueMode))throw new Error("Choose an issue mode.");
 requireDate(preparedDate);requireDate(issueDate);
 if(issueDate<preparedDate)throw new Error("Planned issue date cannot precede preparation.");
 if(issueMode==="Issue now, future due date"&&issueDate!==preparedDate)throw new Error("For issue-now preparation, the planned issue date must equal the preparation date.");
 if(issueMode==="Schedule for later"&&issueDate<=preparedDate)throw new Error("Scheduled issue must be later than preparation.");
 if(kind==="Demand"){requireDate(dueDate);if(dueDate<issueDate)throw new Error("Due date cannot precede planned issue.");}
 const periods=kind==="Demand"?planningPeriods(yearStart,frequency):[];
 if(kind==="Demand"&&(!Number.isInteger(periodIndex)||periodIndex<0||periodIndex>=periods.length))throw new Error("Choose a valid charge period.");
 if(!schedules.length||schedules.some(s=>!s.id.trim()||!s.name.trim())||new Set(schedules.map(s=>s.id)).size!==schedules.length)throw new Error("Add named lease schedules with distinct identifiers.");
 const imported=schedules.filter(schedule=>schedule.id.startsWith("import-budget:"));
 if(imported.length&&(schedules.length!==1||kind!=="Demand"||frequency!=="Annual"||imported[0].id!==`import-budget:${blockId}:${yearStart}`||batchId!==imported[0].id))throw new Error("Imported budgets require their stable building/year identity and a single Annual demand schedule. Re-import to change the confirmed year.");
 return schedules.flatMap(schedule=>apportionLeaseBudget(schedule.annualPence,schedule.shares).map(allocation=>{
  const amount=kind==="Surplus credit"?allocation.amountPence:Math.floor(allocation.amountPence/periods.length)+(periodIndex<allocation.amountPence%periods.length?1:0);
  return {idempotencyKey:`${batchId}:${schedule.id}:${allocation.unitId}:${kind==="Demand"?periodIndex:"surplus"}`,scheduleId:schedule.id,scheduleName:schedule.name,unitId:allocation.unitId,entryType:kind==="Demand"?"Charge" as const:"Credit" as const,amountPence:amount,preparedDate,plannedIssueDate:issueDate,dueDate:kind==="Demand"?dueDate:null,chargePeriod:kind==="Demand"?periods[periodIndex]:null};
 }).filter(row=>row.amountPence>0));
}

export type FinancialScheduleForm={id:string;name:string;amount:string;percentages:Record<number,string>};
export type PreparedFinancialBatch={input:FinancialDraftInput;rows:FinancialDraftRow[]};
export type FinancialPlanningState={
 version:1;blockId:number;kind:"Demand"|"Surplus credit";schedules:FinancialScheduleForm[];
 frequency:DemandFrequency;yearStart:string;periodIndex:number;
 issueMode:FinancialDraftInput["issueMode"];issueDate:string;dueDate:string;
 prepared:PreparedFinancialBatch|null;
};
/** Validates stored form data and recomputes prepared amounts. Never trusts stored row totals. */
export function validateFinancialState(value:unknown,blockId:number,unitIds:number[],today:string):FinancialPlanningState{
 const invalid=()=>{throw new Error("Saved financial preparation is invalid or no longer matches this block’s units. Review the saved budget before continuing.");};
 if(!value||typeof value!=="object"||Array.isArray(value))return invalid();
 const state=value as FinancialPlanningState;
 if(state.version!==1||state.blockId!==blockId||!["Demand","Surplus credit"].includes(state.kind)||!["Annual","Half-yearly","Quarterly","English quarters"].includes(state.frequency)||!["Issue now, future due date","Schedule for later"].includes(state.issueMode))return invalid();
 if(!Number.isInteger(state.periodIndex)||state.periodIndex<0||state.periodIndex>3)return invalid();
 for(const date of [state.yearStart,state.issueDate,state.dueDate])if(typeof date!=="string"||(date!==""&&!validPlanningDate(date)))return invalid();
 if(!Array.isArray(state.schedules)||state.schedules.length<1||state.schedules.length>100)return invalid();
 const allowed=new Set(unitIds.map(String));
 for(const schedule of state.schedules){
  if(!schedule||typeof schedule!=="object"||typeof schedule.id!=="string"||!schedule.id||schedule.id.length>100||typeof schedule.name!=="string"||schedule.name.length>200||typeof schedule.amount!=="string"||schedule.amount.length>30||!schedule.percentages||typeof schedule.percentages!=="object"||Array.isArray(schedule.percentages))return invalid();
  for(const [id,percentage] of Object.entries(schedule.percentages))if(!allowed.has(id)||typeof percentage!=="string"||percentage.length>20)return invalid();
 }
 if(new Set(state.schedules.map(schedule=>schedule.id)).size!==state.schedules.length)return invalid();
 let prepared:PreparedFinancialBatch|null=null;
 if(state.prepared!==null){
  try{
   const input=state.prepared.input;
   if(!input||input.blockId!==blockId||!validPlanningDate(input.preparedDate)||input.preparedDate>today||typeof input.batchId!=="string"||input.batchId.length>100)return invalid();
   const expected={batchId:input.batchId,blockId,kind:state.kind,preparedDate:input.preparedDate,issueDate:state.issueDate,dueDate:state.dueDate,issueMode:state.issueMode,frequency:state.frequency,yearStart:state.yearStart,periodIndex:state.periodIndex,schedules:state.schedules.map(schedule=>({id:schedule.id,name:schedule.name,annualPence:parsePounds(schedule.amount),shares:unitIds.map(unitId=>({unitId,percentage:schedule.percentages[unitId]??""}))}))};
   // Structural equality independent of incoming object key order.
   if(input.kind!==expected.kind||input.issueDate!==expected.issueDate||input.dueDate!==expected.dueDate||input.issueMode!==expected.issueMode||input.frequency!==expected.frequency||input.yearStart!==expected.yearStart||input.periodIndex!==expected.periodIndex||!Array.isArray(input.schedules)||input.schedules.length!==expected.schedules.length)return invalid();
   for(let index=0;index<expected.schedules.length;index++){
    const actual=input.schedules[index],wanted=expected.schedules[index];
    if(actual.id!==wanted.id||actual.name!==wanted.name||actual.annualPence!==wanted.annualPence||!Array.isArray(actual.shares)||actual.shares.length!==wanted.shares.length)return invalid();
    for(const share of wanted.shares)if(!actual.shares.some(item=>item.unitId===share.unitId&&item.percentage===share.percentage))return invalid();
   }
   const rows=prepareFinancialDraft(expected);
   if(!rows.length)return invalid();
   prepared={input:expected,rows};
  }catch{return invalid();}
 }
 return {version:1,blockId,kind:state.kind,schedules:state.schedules.map(schedule=>({id:schedule.id,name:schedule.name,amount:schedule.amount,percentages:{...schedule.percentages}})),frequency:state.frequency,yearStart:state.yearStart,periodIndex:state.periodIndex,issueMode:state.issueMode,issueDate:state.issueDate,dueDate:state.dueDate,prepared};
}

/** Conversion only: caller must authorize manager scope and approve the immutable batch before invoking the ledger RPC. */
export async function financialDraftToLedgerRows(input:FinancialDraftInput,units:{id:number;blockId:number;unitNumber:string}[],approved:boolean){
 if(!approved)throw new Error("Explicit manager approval is required before preparing ledger inputs.");
 const rows=prepareFinancialDraft(input);
 if(!rows.length||rows.length>500)throw new Error("Ledger imports require 1 to 500 allocations per atomic batch.");
 const scopedUnits=new Map(units.filter(unit=>unit.blockId===input.blockId).map(unit=>[unit.id,unit]));
 return Promise.all(rows.map(async row=>{
  const unit=scopedUnits.get(row.unitId);
  if(!unit||!unit.unitNumber.trim()||unit.unitNumber.length>80)throw new Error("A unit is missing or is outside this block.");
  if(row.amountPence>100000000)throw new Error("An allocation exceeds the ledger’s £1,000,000 per-entry limit.");
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`london-financial-ledger-v1:${input.blockId}:${row.idempotencyKey}`))).slice(0,16);
  bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  const request_id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const period=row.chargePeriod?` (${row.chargePeriod.start} to ${row.chargePeriod.end})`:" (surplus allocation)";
  const description=`${row.scheduleName}${period}`;
  if(description.length>300)throw new Error("Schedule description exceeds the ledger’s 300 character limit.");
  return {unit_number:unit.unitNumber,entry_type:row.entryType,description,amount:(row.amountPence/100).toFixed(2),amount_pence:row.amountPence,entry_date:row.plannedIssueDate,due_date:row.dueDate??"",reference:"",request_id};
 }));
}
