import {createHash} from "node:crypto";
import {parse} from "csv-parse/sync";
import {bankDate,bankMoney,type BankMapping} from "./bank-reconciliation.ts";

/** Bank cash observations only. No observation implies a ledger receipt or supplier settlement. */
export type BuildingCashflowRow={id:number;block_id:number;transaction_date:string;amount_pence:number;bank_reference:string;description:string;transaction_id:string;source_file:string;status:"Unreconciled";imported_at:string};
export type StagedCashflowRow=Omit<BuildingCashflowRow,"id"|"block_id"|"status"|"imported_at">&{fingerprint:string};
export function inspectCashflowCsv(text:string){
 if(new TextEncoder().encode(text).length>2_000_000)throw new Error("Upload a CSV bank statement under 2 MB.");
 const records=parse(text,{bom:true,trim:true,skip_empty_lines:true,max_record_size:20000}) as string[][];
 const headers=records[0];
 if(!headers?.length||headers.length>60||headers.some(header=>!header)||new Set(headers).size!==headers.length)throw new Error("Provide unique, nonempty CSV column headings.");
 if(records.length<2||records.length>1001)throw new Error("Provide 1 to 1000 statement transactions.");
 if(records.some(row=>row.length!==headers.length))throw new Error("Each CSV row must match its column headings.");
 return {headers,records:records.slice(1),sample:records.slice(1,4)};
}
export function stageCashflowCsv(text:string,value:unknown,sourceFile:string):{rows:StagedCashflowRow[];skipped:number}{
 const {headers,records}=inspectCashflowCsv(text);
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Map the bank statement columns.");
 const mapping=value as BankMapping;
 for(const key of ["date","reference","description","amount","credit","debit","transactionId","dateFormat"] as const)if(typeof mapping[key]!=="string")throw new Error("Invalid bank statement column mapping.");
 if(!["ISO","UK"].includes(mapping.dateFormat)||!headers.includes(mapping.date)||(!mapping.reference&&!mapping.description)||(!mapping.amount&&!mapping.credit&&!mapping.debit))throw new Error("Choose a date, reference/description, and signed amount or money-in/money-out columns.");
 for(const key of ["reference","description","amount","credit","debit","transactionId"] as const)if(mapping[key]&&!headers.includes(mapping[key]))throw new Error("A selected CSV column is missing.");
 if(mapping.amount&&(mapping.credit||mapping.debit))throw new Error("Choose signed amount OR separate money-in/money-out columns, not both.");
 if(mapping.credit&&mapping.debit&&mapping.credit===mapping.debit)throw new Error("Money-in and money-out must use different columns.");
 const occurrence=new Map<string,number>();const transactionIds=new Map<string,string>();let skipped=0;
 const canonical=(value:string)=>value.toUpperCase().replace(/\s+/g," ").trim();
 const rows=records.flatMap((values,index)=>{
  try{
   const get=(column:string)=>column?values[headers.indexOf(column)]:"";
   const transaction_date=bankDate(get(mapping.date),mapping.dateFormat);
   let amount_pence:number;
   if(mapping.amount)amount_pence=bankMoney(get(mapping.amount));
   else {const credit=bankMoney(get(mapping.credit)),debit=bankMoney(get(mapping.debit));if(credit<0||debit<0||(credit!==0&&debit!==0))throw new Error("Use positive money-in/money-out values with only one side populated.");amount_pence=credit-debit;}
   if(amount_pence===0){skipped++;return [];}
   const bank_reference=get(mapping.reference),description=get(mapping.description),transaction_id=get(mapping.transactionId).trim();
   if(bank_reference.length>500||description.length>1000||transaction_id.length>200||/[\u0000]/.test(bank_reference+description+transaction_id))throw new Error("Transaction details are invalid or too long.");
   const identity=JSON.stringify([transaction_date,amount_pence,canonical(bank_reference),canonical(description)]);
   const n=(occurrence.get(identity)??0)+1;occurrence.set(identity,n);
   if(transaction_id){const previous=transactionIds.get(transaction_id);const financialIdentity=JSON.stringify([transaction_date,amount_pence]);if(previous&&previous!==financialIdentity)throw new Error("Repeated bank transaction ID has a different date or amount.");transactionIds.set(transaction_id,financialIdentity);}
   const fingerprint=createHash("sha256").update(transaction_id?`id:${transaction_id}`:`row:${identity}:${n}`).digest("hex");
   return [{fingerprint,transaction_date,amount_pence,bank_reference,description,transaction_id,source_file:sourceFile.slice(0,200)}];
  }catch(error){throw new Error(`Row ${index+2}: ${error instanceof Error?error.message:"Invalid transaction."}`);}
 });
 return {rows,skipped};
}
export function cashflowDateRange(start:string|null,end:string|null){
 const from=start?bankDate(start,"ISO"):null,to=end?bankDate(end,"ISO"):null;
 if(from&&to&&from>to)throw new Error("Statement start must not follow its end date.");
 return {start:from,end:to};
}
