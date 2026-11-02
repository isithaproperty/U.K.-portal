export const standingOrderCadences=["annual","half_yearly","quarterly","english_quarterly"] as const;
export type StandingOrderConfig={unitId:number;amountPence:number;startDate:string;cadence:typeof standingOrderCadences[number];dueOffsetDays:number;invoiceMode:"invoice_review"|"auto_invoice";allocationMode:"allocation_review"|"auto_exact_match";enabled:boolean;leaseConfirmed:boolean;leaseReference:string};
export function validStandingOrderDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw new Error("Use a valid calendar date.");return value;}
const quarterDays=[[3,25],[6,24],[9,29],[12,25]] as const;
export function validateStandingOrder(value:unknown,unitIds:number[]):StandingOrderConfig{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Standing-order settings are required.");
 const v=value as StandingOrderConfig;
 if(!Number.isSafeInteger(v.unitId)||!unitIds.includes(v.unitId))throw new Error("Choose a unit in this block.");
 if(!Number.isSafeInteger(v.amountPence)||v.amountPence<1||v.amountPence>100000000)throw new Error("Amount must be positive integer pence, up to £1,000,000.");
 if(typeof v.startDate!=="string")throw new Error("Start date required.");validStandingOrderDate(v.startDate);
 if(v.startDate<"2000-01-01"||!standingOrderCadences.includes(v.cadence))throw new Error("Choose a supported schedule starting from 2000 onwards.");
 if(!Number.isSafeInteger(v.dueOffsetDays)||v.dueOffsetDays<0||v.dueOffsetDays>365)throw new Error("Due offset must be 0–365 days after the issue date.");
 if(!["invoice_review","auto_invoice"].includes(v.invoiceMode)||!["allocation_review","auto_exact_match"].includes(v.allocationMode)||typeof v.enabled!=="boolean"||typeof v.leaseConfirmed!=="boolean"||typeof v.leaseReference!=="string"||v.leaseReference.length>300)throw new Error("Invalid standing-order modes or confirmation.");
 if(v.enabled&&(!v.leaseConfirmed||!v.leaseReference.trim()))throw new Error("Enabling requires confirmation of the lease amount, cadence and due rules with a lease reference.");
 if(v.cadence==="english_quarterly"&&!quarterDays.some(([m,d])=>Number(v.startDate.slice(5,7))===m&&Number(v.startDate.slice(8))===d))throw new Error("English quarter dates are 25 March, 24 June, 29 September and 25 December; the lease controls.");
 return {unitId:v.unitId,amountPence:v.amountPence,startDate:v.startDate,cadence:v.cadence,dueOffsetDays:v.dueOffsetDays,invoiceMode:v.invoiceMode,allocationMode:v.allocationMode,enabled:v.enabled,leaseConfirmed:v.leaseConfirmed,leaseReference:v.leaseReference.trim()};
}
export function standingOrderOccurrences(config:StandingOrderConfig,today:string){
 validateStandingOrder(config,[config.unitId]);validStandingOrderDate(today);const result:{issueDate:string;dueDate:string;key:string}[]=[];
 const date=new Date(`${config.startDate}T00:00:00Z`),year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate();
 const quarter=quarterDays.findIndex(([m,d])=>m===month+1&&d===day);
 for(let index=0;index<=500;index++){
  let issue:Date;
  if(config.cadence==="english_quarterly"){
   if(quarter<0)throw new Error("Invalid English quarter anchor.");
   const q=quarter+index,[m,d]=quarterDays[q%4];issue=new Date(Date.UTC(year+Math.floor(q/4),m-1,d));
  }else{
   const step=config.cadence==="annual"?12:config.cadence==="half_yearly"?6:3;
   const last=new Date(Date.UTC(year,month+step*index+1,0)).getUTCDate();issue=new Date(Date.UTC(year,month+step*index,Math.min(day,last)));
  }
  const issueDate=issue.toISOString().slice(0,10);if(issueDate>today)break;
  if(index===500)throw new Error("Schedule exceeds 500 historical periods. Review and narrow the effective start date.");
  const dueDate=new Date(issue.getTime()+config.dueOffsetDays*86400000).toISOString().slice(0,10);
  result.push({issueDate,dueDate,key:`standing-order:${config.unitId}:${issueDate}`});
 }
 return result;
}
export const normalizedPaymentReference=(value:string)=>value.toUpperCase().replace(/\s/g,"");
export type StandingOrderBankRow={id:number;blockId:number;transactionDate:string;amountPence:number;reference:string;status:string};
export function exactStandingOrderMatches(config:StandingOrderConfig,blockId:number,paymentReference:string|null,rows:StandingOrderBankRow[],today:string,unitsWithReference:number){
 if(!config.enabled||!config.leaseConfirmed||config.allocationMode!=="auto_exact_match"||!paymentReference||unitsWithReference!==1)return [];
 validStandingOrderDate(today);
 const ref=normalizedPaymentReference(paymentReference);
 return rows.filter(row=>row.blockId===blockId&&row.status==="Pending"&&row.transactionDate>=config.startDate&&row.transactionDate<=today&&row.amountPence===config.amountPence&&normalizedPaymentReference(row.reference)===ref).map(row=>({id:row.id,unit_id:config.unitId}));
}
