import type {Unit,WorkOrder} from "../app/types";
import type {ChargeEntry} from "./service-charges";
import type {SupplierInvoice} from "./creditors";
import type {SupplierSettlementRecord,SupplierSettlementAllocation} from "./supplier-settlements";
import {agedAccount} from "./debtors.ts";

/** Read-only accounting view. Bank staging and editable payment drafts are deliberately not inputs. */
export type BuildingStatementInput={blockId:number;start:string;end:string;units:Unit[];workOrders:WorkOrder[];entries:ChargeEntry[];invoices:SupplierInvoice[];settlements:SupplierSettlementRecord[];allocations:SupplierSettlementAllocation[]};
export type StatementResidentAccount={unitId:number;unitNumber:string;openingPence:number;chargesPence:number;paymentsPence:number;creditsPence:number;closingPence:number;outstandingPence:number;creditBalancePence:number;overduePence:number};
export type BuildingStatement={
 blockId:number;start:string;end:string;
 workOrders:(WorkOrder&{estimatedPence:number|null;actualPence:number|null;paidPence:number|null;unpaidPence:number|null;invoicePaymentStatus:"No invoice recorded"|"Unpaid"|"Part paid"|"Paid"})[];
 invoices:(SupplierInvoice&{inPeriod:boolean;paidPence:number;outstandingPence:number})[];
 residentAccounts:StatementResidentAccount[];
 totals:{workOrderCount:number;estimatedPence:number;actualPence:number;missingEstimateCount:number;missingActualCount:number;invoicedPence:number;supplierPaymentsPence:number;openingSupplierDebtPence:number;closingSupplierDebtPence:number;residentOpeningPence:number;residentChargesPence:number;residentPaymentsPence:number;residentCreditsPence:number;residentClosingPence:number;residentOutstandingPence:number;residentCreditBalancesPence:number;residentOverduePence:number};
 warnings:string[];
};
function date(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T12:00:00Z`))||new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)!==value)throw new Error("Use valid YYYY-MM-DD statement dates.");return value;}
function pence(value:number){if(!Number.isSafeInteger(value)||value<=0)throw new Error("Accounting entries require positive integer pence.");return value;}
function unique<T>(rows:T[],id:(row:T)=>string|number,label:string){if(new Set(rows.map(id)).size!==rows.length)throw new Error(`Duplicate ${label} identifiers make this statement unreliable.`);}
function cost(value:number|null){if(value===null)return null;if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.00001)throw new Error("Work-order costs must be nonnegative amounts in pounds with at most two decimal places.");return Math.round(value*100);}
const sum=(values:number[])=>{const result=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(result))throw new Error("Statement total exceeds supported accounting precision.");return result;};
export function buildBuildingStatement(input:BuildingStatementInput):BuildingStatement{
 const {blockId,start,end}=input;date(start);date(end);if(start>end||!Number.isSafeInteger(blockId)||blockId<=0)throw new Error("Choose a valid building and statement date range.");
 const within=(value:string)=>value>=start&&value<=end;
 const warnings:string[]=[];
 const units=input.units.filter(row=>row.blockId===blockId);unique(units,row=>row.id,"unit");const unitIds=new Set(units.map(row=>row.id));
 const orders=input.workOrders.filter(row=>row.blockId===blockId);unique(orders,row=>row.id,"work order");const orderById=new Map(orders.map(row=>[row.id,row]));
 const workOrders=orders.filter(row=>within(date(row.createdAt.slice(0,10)))).map(row=>({...row,estimatedPence:cost(row.estimatedCost),actualPence:cost(row.actualCost)}));
 // Invoice scope is established by its linked work order, never by invoice number or supplier alone.
 const scopedInvoices=input.invoices.filter(row=>orderById.has(row.workOrderId));unique(scopedInvoices,row=>row.id,"invoice");
 for(const invoice of scopedInvoices){pence(invoice.amountPence);date(invoice.invoiceDate);date(invoice.dueDate);if(invoice.contractorId!==orderById.get(invoice.workOrderId)!.contractorId)throw new Error("An invoice is linked to the wrong work-order supplier.");}
 const invoiceById=new Map(scopedInvoices.map(row=>[row.id,row]));
 const settlements=input.settlements.filter(row=>row.block_id===blockId);unique(settlements,row=>row.id,"settlement");
 // Only canonical, completely allocated and internally consistent settlements can settle supplier debt.
 const validAllocations:(SupplierSettlementAllocation&{paymentDate:string})[]=[];
 for(const settlement of settlements){
  date(settlement.payment_date);pence(settlement.amount_pence);if(settlement.payment_date>end)continue;
  const allocations=input.allocations.filter(row=>row.settlement_id===settlement.id);
  const valid=allocations.length>0&&new Set(allocations.map(row=>row.invoice_id)).size===allocations.length&&allocations.every(row=>{
   const invoice=invoiceById.get(row.invoice_id);
   return Number.isSafeInteger(row.amount_pence)&&row.amount_pence>0&&invoice&&invoice.workOrderId===row.work_order_id&&invoice.invoiceDate<=settlement.payment_date;
  })&&sum(allocations.map(row=>row.amount_pence))===settlement.amount_pence;
  if(!valid){warnings.push(`Settlement ${settlement.id} has incomplete or invalid allocations; excluded from verified payments and debt settlement.`);continue;}
  validAllocations.push(...allocations.map(row=>({...row,paymentDate:settlement.payment_date})));
 }
 const invoices=scopedInvoices.filter(row=>row.invoiceDate<=end).map(row=>{
  const paidPence=sum(validAllocations.filter(a=>a.invoice_id===row.id).map(a=>a.amount_pence));
  if(paidPence>row.amountPence)throw new Error("Verified allocations exceed an invoice amount; resolve this before using the statement.");
  return {...row,inPeriod:within(row.invoiceDate),paidPence,outstandingPence:row.amountPence-paidPence};
 });
 const openingSupplierDebtPence=sum(scopedInvoices.filter(row=>row.invoiceDate<start).map(row=>row.amountPence-sum(validAllocations.filter(a=>a.invoice_id===row.id&&a.paymentDate<start).map(a=>a.amount_pence))));
 const allEntries=input.entries.filter(row=>row.block_id===blockId);unique(allEntries,row=>row.id,"ledger entry");
 if(allEntries.some(row=>!unitIds.has(row.unit_id)))warnings.push("Ledger entries for units missing from the supplied building register were excluded; resident balances may be incomplete.");
 const entries=allEntries.filter(row=>unitIds.has(row.unit_id));
 for(const row of entries){date(row.entry_date);if(row.due_date)date(row.due_date);pence(row.amount_pence);if(!["Charge","Payment","Credit"].includes(row.entry_type))throw new Error("Unrecognized resident ledger entry type.");}
 const previous=new Date(`${start}T12:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);const openingDate=previous.toISOString().slice(0,10);
 const residentAccounts=units.map(unit=>{
  const account=entries.filter(row=>row.unit_id===unit.id),period=account.filter(row=>within(row.entry_date));
  const openingPence=agedAccount(account,openingDate).balance,closing=agedAccount(account,end);
  return {unitId:unit.id,unitNumber:unit.unitNumber,openingPence,chargesPence:sum(period.filter(row=>row.entry_type==="Charge").map(row=>row.amount_pence)),paymentsPence:sum(period.filter(row=>row.entry_type==="Payment").map(row=>row.amount_pence)),creditsPence:sum(period.filter(row=>row.entry_type==="Credit").map(row=>row.amount_pence)),closingPence:closing.balance,outstandingPence:Math.max(0,closing.balance),creditBalancePence:Math.max(0,-closing.balance),overduePence:closing.days1to30+closing.days31to60+closing.days61to90+closing.days91plus};
 });
 const residentTotal=(key:keyof Omit<StatementResidentAccount,"unitId"|"unitNumber">)=>sum(residentAccounts.map(row=>row[key]));
 return {blockId,start,end,workOrders:workOrders.map(order=>{
  const linked=invoices.filter(invoice=>invoice.workOrderId===order.id);
  const paidPence=linked.length?sum(linked.map(invoice=>invoice.paidPence)):null;
  const unpaidPence=linked.length?sum(linked.map(invoice=>invoice.outstandingPence)):null;
  const invoicePaymentStatus=paidPence===null?"No invoice recorded":unpaidPence===0?"Paid":paidPence>0?"Part paid":"Unpaid";
  return {...order,paidPence,unpaidPence,invoicePaymentStatus};
 }),invoices,residentAccounts,warnings,totals:{workOrderCount:workOrders.length,estimatedPence:sum(workOrders.map(row=>row.estimatedPence??0)),actualPence:sum(workOrders.map(row=>row.actualPence??0)),missingEstimateCount:workOrders.filter(row=>row.estimatedPence===null).length,missingActualCount:workOrders.filter(row=>row.actualPence===null).length,invoicedPence:sum(invoices.filter(row=>row.inPeriod).map(row=>row.amountPence)),supplierPaymentsPence:sum(validAllocations.filter(row=>within(row.paymentDate)).map(row=>row.amount_pence)),openingSupplierDebtPence,closingSupplierDebtPence:sum(invoices.map(row=>row.outstandingPence)),residentOpeningPence:residentTotal("openingPence"),residentChargesPence:residentTotal("chargesPence"),residentPaymentsPence:residentTotal("paymentsPence"),residentCreditsPence:residentTotal("creditsPence"),residentClosingPence:residentTotal("closingPence"),residentOutstandingPence:residentTotal("outstandingPence"),residentCreditBalancesPence:residentTotal("creditBalancePence"),residentOverduePence:residentTotal("overduePence")}};
}
/** Text fields are escaped and formula-neutralized for spreadsheet applications. Amounts are GBP. */
export function statementCsv(statement:BuildingStatement):string{
 const rows:(string|number|null)[][]=[["Building financial statement","Building ID",statement.blockId],["From",statement.start,"To",statement.end],["Basis","Recorded data only. WO costs are not cash spend. Unmatched bank rows do not settle debts."],["Summary","Value"]];
 const labels:Record<keyof BuildingStatement["totals"],string>={
  workOrderCount:"Work orders raised (count)",estimatedPence:"Estimated WO costs GBP",actualPence:"Recorded actual WO costs GBP",
  missingEstimateCount:"Work orders missing estimate (count)",missingActualCount:"Work orders missing actual cost (count)",
  invoicedPence:"Supplier invoices in period GBP",supplierPaymentsPence:"Verified supplier payments GBP",
  openingSupplierDebtPence:"Opening supplier amount outstanding GBP",closingSupplierDebtPence:"Closing supplier amount outstanding GBP",
  residentOpeningPence:"Resident opening balance GBP",residentChargesPence:"Resident charges GBP",residentPaymentsPence:"Resident payments GBP",
  residentCreditsPence:"Resident credits GBP",residentClosingPence:"Resident closing balance GBP",residentOutstandingPence:"Resident outstanding GBP",
  residentCreditBalancesPence:"Resident credit balances GBP",residentOverduePence:"Resident overdue GBP"
 };
 for(const key of Object.keys(statement.totals) as (keyof BuildingStatement["totals"])[]){const value=statement.totals[key];rows.push([labels[key],key.endsWith("Pence")?(value/100).toFixed(2):value]);}
 rows.push([], ["Work orders raised in period"],["Number","Raised","Title","Status","Estimated GBP","Actual recorded cost GBP","Paid GBP (linked invoices)","Unpaid GBP (linked invoices)","Invoice payment status"]);
 for(const row of statement.workOrders)rows.push([row.workOrderNumber,row.createdAt.slice(0,10),row.title,row.status,row.estimatedPence===null?"Unknown":(row.estimatedPence/100).toFixed(2),row.actualPence===null?"Unknown":(row.actualPence/100).toFixed(2),row.paidPence===null?"Not recorded":(row.paidPence/100).toFixed(2),row.unpaidPence===null?"Not recorded":(row.unpaidPence/100).toFixed(2),row.invoicePaymentStatus]);
 rows.push([], ["Supplier invoices through statement end"],["Invoice","Work order ID","Invoice date","Issued in period","Amount GBP","Paid GBP (verified)","Unpaid GBP"]);
 for(const row of statement.invoices)rows.push([row.number,row.workOrderId,row.invoiceDate,row.inPeriod?"Yes":"No",(row.amountPence/100).toFixed(2),(row.paidPence/100).toFixed(2),(row.outstandingPence/100).toFixed(2)]);
 rows.push([], ["Resident unit accounts"],["Unit","Opening GBP","Charges GBP","Payments GBP","Credits GBP","Closing GBP","Outstanding GBP","Credit balance GBP","Overdue GBP"]);
 for(const row of statement.residentAccounts)rows.push([row.unitNumber,...[row.openingPence,row.chargesPence,row.paymentsPence,row.creditsPence,row.closingPence,row.outstandingPence,row.creditBalancePence,row.overduePence].map(value=>(value/100).toFixed(2))]);
 for(const warning of statement.warnings)rows.push(["Warning",warning]);
 const cell=(value:string|number|null)=>{let text=String(value??"");if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)&&!/^-?\d+(?:\.\d+)?$/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 return "\uFEFF"+rows.map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
