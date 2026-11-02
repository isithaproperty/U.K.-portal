import {NextResponse} from "next/server";
import {createClient} from "./supabase/server";
import {canManageReviewBlock} from "./management-review";
export const managementReply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function managementAccess(blockId:number){
 if(!Number.isSafeInteger(blockId)||blockId<1)return {response:managementReply({error:"Invalid block."},400)};
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)return {response:managementReply({error:"Portfolio connection is not configured."},503)};
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();if(error||!user?.email)return {response:managementReply({error:"Sign in required."},401)};
 const {data:member,error:memberError}=await client.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 if(memberError||!member||!["owner","admin","manager"].includes(member.role))return {response:managementReply({error:"Manager access required."},403)};
 const {data:block,error:blockError}=await client.from("blocks").select("id,manager,name,address,management_company").eq("id",blockId).maybeSingle();
 if(blockError||!block)return {response:managementReply({error:"Block unavailable."},404)};
 if(!canManageReviewBlock(member,block.manager))return {response:managementReply({error:"Block is outside your management portfolio."},403)};
 return {client,user,member,block};
}
