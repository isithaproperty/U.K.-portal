import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {canManageReviewBlock} from "../../../../../lib/management-review";
import {communicationFingerprint,isCommunicationAudience,resolveCommunicationRecipients} from "../../../../../lib/communication-recipients";
type Context={params:Promise<{blockId:string}>};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:NextRequest,context:Context){
 const {blockId:raw}=await context.params,blockId=Number(raw),audience=request.nextUrl.searchParams.get("audience");
 if(!Number.isSafeInteger(blockId)||blockId<1||!isCommunicationAudience(audience))return reply({error:"Select a valid block and audience."},400);
 const client=await createClient();const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user?.email)return reply({error:"Sign in required."},401);
 const {data:member,error:memberError}=await client.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 const {data:block,error:blockError}=await client.from("blocks").select("id,name,manager").eq("id",blockId).maybeSingle();
 if(memberError||!member||!canManageReviewBlock(member,block?.manager??""))return reply({error:"Manager access to this block is required."},403);
 if(blockError||!block)return reply({error:"Block unavailable."},404);
 const residents:{id:number;email:string;block_id:number}[]=[];
 for(let offset=0;offset<=10000;offset+=1000){const {data,error}=await client.from("residents").select("id,email,block_id").is("archived_at",null).eq("block_id",blockId).order("id").range(offset,offset+999);if(error)return reply({error:"Resident assignments could not be loaded."},503);residents.push(...(data??[]));if((data??[]).length<1000)break;if(offset===10000)return reply({error:"This block exceeds the 10,000-assignment preview limit."},400);}
 let state:unknown=null,revision=0;
 if(audience==="saved-contacts"){
  const {data,error}=await client.from("management_review_state").select("state,revision").eq("block_id",blockId).eq("area","leaseholders").maybeSingle();
  if(error)return reply({error:"Saved contact storage is unavailable. Install the reviewed management migration first."},503);
  state=data?.state??null;revision=data?.revision??0;
 }
 try{const resolved=resolveCommunicationRecipients(blockId,audience,residents??[],state),fingerprint=await communicationFingerprint({blockId,audience,revision,...resolved});return reply({blockId,audience,revision,...resolved,fingerprint});}
 catch(error){return reply({error:error instanceof Error?error.message:"Recipients could not be verified."},400);}
}
