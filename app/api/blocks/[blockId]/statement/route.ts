import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {canManageReviewBlock} from "../../../../../lib/management-review";
import {validateCreditorState} from "../../../../../lib/creditors";
import {londonDate,type ChargeEntry} from "../../../../../lib/service-charges";
import type {Unit,WorkOrder} from "../../../../types";
import type {SupplierSettlementRecord,SupplierSettlementAllocation} from "../../../../../lib/supplier-settlements";

type Context={params:Promise<{blockId:string}>};
type Page<T>={data:T[]|null;error:unknown;count:number|null};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
function validDate(value:string|null):value is string{
 return !!value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
}
/** Exact counts and stable ordering prevent a truncated page from appearing as a complete statement. */
async function allRows<T>(label:string,page:(from:number,to:number)=>PromiseLike<Page<T>>,key:(row:T)=>string):Promise<T[]>{
 const rows:T[]=[],seen=new Set<string>();let expected:number|null=null;
 for(let from=0;;from+=1000){
  const result=await page(from,from+999);
  if(result.error||!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count!<0)throw new Error(`${label} could not be read completely. No statement was generated.`);
  const count=result.count as number;
  if(count>100000)throw new Error(`${label} exceeds the 100,000-row statement limit. Request a scoped export; no partial statement was generated.`);
  if(expected!==null&&expected!==count)throw new Error(`${label} changed while loading. Refresh to generate a complete statement.`);
  expected=count;
  if(result.data.length!==Math.min(1000,Math.max(0,count-from)))throw new Error(`${label} returned an incomplete page. No statement was generated.`);
  for(const row of result.data){const id=key(row);if(seen.has(id))throw new Error(`${label} changed while loading. Refresh to generate a complete statement.`);seen.add(id);rows.push(row);}
  if(rows.length===count)return rows;
 }
}
export async function GET(request:NextRequest,context:Context){
 const blockId=Number((await context.params).blockId),start=request.nextUrl.searchParams.get("start"),end=request.nextUrl.searchParams.get("end");
 if(!Number.isSafeInteger(blockId)||blockId<1)return reply({error:"Invalid block."},400);
 if(!validDate(start)||!validDate(end)||start>end)return reply({error:"Provide valid start and end dates as YYYY-MM-DD, with start on or before end."},400);
 try{
  const client=await createClient(),{data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user?.email)return reply({error:"Sign in required."},401);
  const {data:member,error:memberError}=await client.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
  const {data:block,error:blockError}=await client.from("blocks").select("id,manager").eq("id",blockId).maybeSingle();
  if(memberError||!member||blockError||!block||!canManageReviewBlock(member,block.manager))return reply({error:"Manager block access required."},403);
  const [unitRows,orderRows,entries,settlements,allocations,saved]=await Promise.all([
   allRows("Units",(from,to)=>client.from("units").select("id,block_id,unit_number,payment_reference",{count:"exact"}).eq("block_id",blockId).order("id").range(from,to),row=>String(row.id)),
   allRows("Work orders",(from,to)=>client.from("work_orders").select("id,is_ongoing,work_order_number,block_id,unit_id,resident_id,contractor_id,title,description,category,priority,status,contractor,estimated_cost,actual_cost,notes,address_snapshot,payment_status,payment_approved_by,payment_approved_at,paid_at,created_by,created_at,updated_at",{count:"exact"}).eq("block_id",blockId).order("id").range(from,to),row=>String(row.id)),
   allRows<ChargeEntry>("Resident ledger",(from,to)=>client.from("service_charge_entries").select("id,block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference",{count:"exact"}).eq("block_id",blockId).lte("entry_date",end).order("id").range(from,to),row=>String(row.id)),
   allRows<SupplierSettlementRecord>("Supplier settlements",(from,to)=>client.from("supplier_settlements").select("id,block_id,bank_transaction_id,payment_date,amount_pence,evidence,recorded_by,recorded_at",{count:"exact"}).eq("block_id",blockId).lte("payment_date",end).order("id").range(from,to),row=>row.id),
   allRows<SupplierSettlementAllocation>("Supplier allocations",(from,to)=>client.from("supplier_settlement_allocations").select("settlement_id,invoice_id,amount_pence,work_order_id",{count:"exact"}).eq("block_id",blockId).order("settlement_id").order("invoice_id").range(from,to),row=>JSON.stringify([row.settlement_id,row.invoice_id])),
   client.from("management_review_state").select("state,revision").eq("block_id",blockId).eq("area","creditors").maybeSingle(),
  ]);
  if(saved.error)throw new Error("Saved supplier invoices could not be read. No statement was generated.");
  const units:Unit[]=unitRows.map(row=>({id:row.id,blockId:row.block_id,unitNumber:row.unit_number,paymentReference:row.payment_reference}));
  const workOrders:WorkOrder[]=orderRows.map(row=>({id:row.id,isOngoing:row.is_ongoing===true,workOrderNumber:row.work_order_number,blockId:row.block_id,unitId:row.unit_id,residentId:row.resident_id,contractorId:row.contractor_id,title:row.title,description:row.description,category:row.category,priority:row.priority,status:row.status,contractor:row.contractor,estimatedCost:row.estimated_cost===null?null:Number(row.estimated_cost),actualCost:row.actual_cost===null?null:Number(row.actual_cost),notes:row.notes,addressSnapshot:row.address_snapshot,paymentStatus:row.payment_status,paymentApprovedBy:row.payment_approved_by,paymentApprovedAt:row.payment_approved_at,paidAt:row.paid_at,createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at}));
  let invoices;
  try{invoices=validateCreditorState(saved.data?.state??{invoices:[],payments:[]},workOrders,blockId,londonDate()).invoices;}
  catch{throw new Error("Saved supplier invoice data failed validation. Review the creditor register before generating a statement.");}
  // Payment drafts are intentionally not returned or included in reported paid amounts.
  return reply({units,workOrders,entries,invoices,settlements,allocations,asOfGeneratedAt:new Date().toISOString()});
 }catch(error){return reply({error:error instanceof Error?error.message:"Statement data is unavailable. No statement was generated."},503);}
}
