import {NextRequest,NextResponse} from "next/server";
import {createClient} from "../../../../../lib/supabase/server";
import {validateStandingOrder} from "../../../../../lib/standing-orders";
async function access(raw:string){
 const blockId=Number(raw);if(!Number.isSafeInteger(blockId)||blockId<1)throw new Error("Invalid block.");
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user?.email)throw new Error("Sign in required.");
 const {data:member,error:memberError}=await supabase.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
 const {data:block,error:blockError}=await supabase.from("blocks").select("id,manager").eq("id",blockId).maybeSingle();
 if(memberError||blockError||!block||!member||!(member.role==="owner"||member.role==="admin"||member.role==="manager"&&member.portfolio_manager===block.manager))throw new Error("Manager access to this block is required.");
 return {supabase,blockId};
}
export async function GET(_request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 try{const {supabase,blockId}=await access((await params).blockId);
  const [{data:orders,error},{data:runs,error:runError}]=await Promise.all([supabase.from("standing_orders").select("*").eq("block_id",blockId).order("unit_id"),supabase.from("standing_order_runs").select("*").eq("block_id",blockId).order("id",{ascending:false}).limit(500)]);
  if(error||runError)throw new Error("Standing-order configuration is unavailable. Check the reviewed migration is installed.");
  return NextResponse.json({orders,runs},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unavailable."},{status:403});}
}
export async function PUT(request:NextRequest,{params}:{params:Promise<{blockId:string}>}){
 try{const {supabase,blockId}=await access((await params).blockId);
  const text=await request.text();if(text.length>10000)throw new Error("Request too large.");const body=JSON.parse(text);
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw new Error("Valid revision required.");
  const {data:units,error:unitError}=await supabase.from("units").select("id").eq("block_id",blockId);if(unitError)throw new Error("Could not verify block units.");
  const config=validateStandingOrder(body.config,(units??[]).map(unit=>unit.id));
  const {data,error}=await supabase.rpc("save_standing_order",{p_block_id:blockId,p_config:config,p_revision:body.revision});
  if(error)return NextResponse.json({error:error.code==="40001"?"Another manager changed these settings. Reload before saving again.":"Standing-order settings could not be saved."},{status:error.code==="40001"?409:400});
  return NextResponse.json({order:data});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not save."},{status:400});}
}
