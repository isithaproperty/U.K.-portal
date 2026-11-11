import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {canManageReviewBlock} from "../../../../../lib/management-review";
import {validateSupplierSettlement} from "../../../../../lib/supplier-settlements";
import {londonDate} from "../../../../../lib/service-charges";
type Context={params:Promise<{blockId:string}>};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
async function access(context:Context){
 const blockId=Number((await context.params).blockId);
 if(!Number.isSafeInteger(blockId)||blockId<1)return {response:reply({error:"Invalid block."},400)};
 const client=await createClient(),{data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user?.email)return {response:reply({error:"Sign in required."},401)};
 const {data:member,error:memberError}=await client.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 const {data:block,error:blockError}=await client.from("blocks").select("id,manager").eq("id",blockId).maybeSingle();
 if(memberError||!member||blockError||!block||!canManageReviewBlock(member,block.manager))return {response:reply({error:"Manager block access required."},403)};
 return {client,member,blockId};
}
export async function GET(_request:NextRequest,context:Context){
 const result=await access(context);if(result.response)return result.response;
 const {client,member,blockId}=result;
 const {data:settlements,error}=await client.from("supplier_settlements").select("id,block_id,bank_transaction_id,payment_date,amount_pence,evidence,recorded_by,recorded_at").eq("block_id",blockId).order("recorded_at",{ascending:false}).limit(1000);
 if(error)return reply({error:"Supplier settlement storage is unavailable. The reviewed settlement migration must be installed."},503);
 const {data:allocations,error:allocationError,count:allocationCount}=await client.from("supplier_settlement_allocations").select("settlement_id,invoice_id,amount_pence,work_order_id",{count:"exact"}).eq("block_id",blockId).limit(10000);
 if((allocationCount??0)>10000)return reply({error:"Settlement history exceeds the current display limit. Request an account-scoped export before recording further payments."},503);
 if(allocationError)return reply({error:"Settlement allocations could not be verified."},503);
 return reply({settlements:settlements??[],allocations:allocations??[],canRecord:member.role==="owner"});
}
export async function POST(request:NextRequest,context:Context){
 const result=await access(context);if(result.response)return result.response;
 const {client,member,blockId}=result;
 if(member.role!=="owner")return reply({error:"Only the portfolio owner may confirm actual supplier payments."},403);
 let body;
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>50000)throw new Error("Settlement request is too large.");body=validateSupplierSettlement(JSON.parse(raw),londonDate());}catch(error){return reply({error:error instanceof Error?error.message:"Invalid settlement."},400);}
 const {data,error}=await client.rpc("record_supplier_settlement",{p_block_id:blockId,p_request:body});
 if(error?.code==="40001")return reply({error:"The saved creditor register changed. Reload and verify the latest invoices before recording."},409);
 if(error?.code==="23505")return reply({error:"This bank transaction or request identifier has already been recorded. Reload settlement history before retrying."},409);
 if(error?.code==="42501")return reply({error:"Owner access is required to record actual payment evidence."},403);
 if(error&&(error.code==="P0001"||error.code?.startsWith("22")))return reply({error:error.message||"Settlement validation failed. No settlement was recorded."},400);
 if(error)return reply({error:"Settlement was not confirmed. Reload history before retrying; retain the same request identifier.",uncertain:true},503);
 return reply({recorded:true,result:data});
}
