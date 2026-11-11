import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../../lib/supabase/server";
import {isReviewArea,canManageReviewBlock,validateReviewState,validateReviewWrite} from "../../../../../../lib/management-review";
import {londonDate} from "../../../../../../lib/service-charges";
import type {WorkOrder} from "../../../../../types";
type Context={params:Promise<{blockId:string;area:string}>};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
async function access(context:Context){
 const {blockId:raw,area}=await context.params,blockId=Number(raw);
 if(!Number.isSafeInteger(blockId)||blockId<1||!isReviewArea(area))return {response:reply({error:"Unknown block or review area."},400)};
 const client=await createClient();const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user?.email)return {response:reply({error:"Sign in required."},401)};
 const {data:member,error:memberError}=await client.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 if(memberError||!member||!["owner","admin","manager"].includes(member.role))return {response:reply({error:"Manager access required."},403)};
 const {data:block,error:blockError}=await client.from("blocks").select("id,manager").eq("id",blockId).maybeSingle();
 if(blockError||!block)return {response:reply({error:"Block unavailable."},404)};
 if(!canManageReviewBlock(member,block.manager))return {response:reply({error:"Block is outside your management portfolio."},403)};
 return {client,blockId,area};
}
export async function GET(_request:NextRequest,context:Context){
 const result=await access(context);if(result.response)return result.response;
 const {client,blockId,area}=result;
 const {data,error}=await client.from("management_review_state").select("state,revision,updated_at").eq("block_id",blockId).eq("area",area).maybeSingle();
 if(error)return reply({error:"Review storage unavailable. The reviewed management migration must be installed before saving."},503);
 return reply(data??{state:null,revision:0});
}
export async function PUT(request:NextRequest,context:Context){
 const result=await access(context);if(result.response)return result.response;
 const {client,blockId,area}=result;
 let body;
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>1500000)return reply({error:"Review data must be under 1.5 MB."},413);body=validateReviewWrite(JSON.parse(raw));}catch(error){return reply({error:error instanceof Error?error.message:"Invalid review data."},400);}
 const {data:units,error:unitError}=await client.from("units").select("id").eq("block_id",blockId);
 if(unitError)return reply({error:"Unit scope could not be verified."},503);
 let orders:WorkOrder[]=[];
 if(area==="creditors"){
  const {data,error}=await client.from("work_orders").select("id,block_id,unit_id,contractor_id,title,contractor").eq("block_id",blockId);
  if(error)return reply({error:"Work order scope could not be verified."},503);
  orders=(data??[]).map(row=>({id:row.id,blockId:row.block_id,unitId:row.unit_id,contractorId:row.contractor_id,title:row.title,contractor:row.contractor})) as WorkOrder[];
 }
 let state;
 try{state=validateReviewState(area,body.state,blockId,(units??[]).map(unit=>unit.id),londonDate(),orders);}catch(error){return reply({error:error instanceof Error?error.message:"Review data failed validation."},400);}
 const {data,error}=await client.rpc("save_management_review",{p_block_id:blockId,p_area:area,p_state:state,p_expected_revision:body.revision});
 if(error){if(error.code==="40001"||error.code==="23505")return reply({error:"Another manager saved a newer revision. Export your changes, then reload before saving."},409);if(error.code==="42501")return reply({error:"Manager access to this block is required."},403);return reply({error:"Review storage unavailable. No save was confirmed; reload before retrying."},503);}
 const row=Array.isArray(data)?data[0]:data;
 if(!row)return reply({error:"No saved revision was returned. Reload to verify the outcome."},503);
 return reply(row);
}
