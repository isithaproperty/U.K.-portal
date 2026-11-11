import {NextRequest, NextResponse} from "next/server";
import {createClient} from "../../../../lib/supabase/server";
import {canManageReviewBlock} from "../../../../lib/management-review";
const fields = ["name", "management_company", "type", "address", "manager", "financial_year_end", "units"] as const;
export async function PATCH(request: NextRequest, {params}: {params: Promise<{blockId:string}>}) {
 const reply=(error:string,status:number)=>NextResponse.json({error},{status});
 try {
  const id=Number((await params).blockId);
  if(!Number.isSafeInteger(id)||id<1)return reply("Invalid block.",400);
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user?.email)return reply("Sign in required.",401);
  const {data:member}=await db.from("portal_members").select("role,portfolio_manager").eq("email",user.email.toLowerCase()).maybeSingle();
  const {data:block,error}=await db.from("blocks").select(fields.join(",")).eq("id",id).maybeSingle();
  if(error||!block)return reply("Block unavailable.",404);
  const current=block as unknown as Record<string,string|number>;
  if(!canManageReviewBlock(member,String(current.manager)))return reply("You cannot edit this block.",403);
  const text=await request.text();if(text.length>20000)return reply("Request too large.",413);
  const {details,original}=JSON.parse(text);
  if(!details||!original)return reply("Reload the block before editing.",400);
  const update:Record<string,string|number>={};
  for(const field of fields){
   if(field==="units"){
    if(!Number.isSafeInteger(details.units)||details.units<Number(current.units)||details.units>100000)return reply("Unit count must be a whole number at least as large as the current count (maximum 100,000).",400);
    update.units=details.units;
   }else{
    if(typeof details[field]!=="string"||!details[field].trim()||details[field].length>(field==="address"?2000:200))return reply("Complete all block details within the field limits.",400);
    update[field]=details[field].trim();
   }
   if(original[field]!==current[field])return reply("This block has changed. Reload and review before saving.",409);
  }
  const date=String(update.financial_year_end);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return reply("Enter a valid financial year end.",400);
  if(!canManageReviewBlock(member,String(update.manager)))return reply("Only an owner or admin can reassign the manager.",403);
  const {count,error:countError}=await db.from("units").select("id",{count:"exact",head:true}).eq("block_id",id);
  if(countError||count===null)return reply("Could not verify existing units.",503);
  if(Number(update.units)<count)return reply(`The count must include all ${count} existing units.`,400);
  let query=db.from("blocks").update(update).eq("id",id);
  for(const field of fields)query=query.eq(field,current[field]);
  const result=await query.select("id").maybeSingle();
  if(result.error)return reply("Block could not be saved. Check your permissions and try again.",400);
  if(!result.data)return reply("This block changed or access was removed. Reload before saving.",409);
  return NextResponse.json({saved:true});
 }catch{return reply("Could not save block details. Please retry after checking your connection.",400);}
}
