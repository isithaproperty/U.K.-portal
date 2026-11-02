import {NextResponse} from "next/server";
import {createClient} from "../../../lib/supabase/server";
export async function GET(){
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)return reply({error:"Connection unavailable."},503);
 const client=await createClient(),{data:{user}}=await client.auth.getUser();if(!user?.email)return reply({error:"Sign in required."},401);
 const {data:member}=await client.from("portal_members").select("role").eq("email",user.email.toLowerCase()).maybeSingle();if(!member||!["owner","admin","manager"].includes(member.role))return reply({error:"Manager access required."},403);
 const {data,error}=await client.from("management_manager_alerts").select("block_id,consultation_id,review_date,snapshot").order("review_date",{ascending:false}).limit(100);if(error)return reply({error:"Review alerts unavailable."},503);return reply({alerts:data});
}
