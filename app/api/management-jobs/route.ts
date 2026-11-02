export const maxDuration=300;
import {NextRequest,NextResponse} from "next/server";
import {verifyCronAuthorization} from "../../../lib/management-dispatch";
import {createWorkerClient} from "../../../lib/supabase/worker";
import {processManagementDispatches} from "../../../lib/management-worker";
import {londonDate} from "../../../lib/service-charges";
export async function GET(request:NextRequest){
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
 if(process.env.LONDON_JOBS_ENABLED!=="1")return reply({error:"Management background jobs are disabled."},503);
 if(!verifyCronAuthorization(request.headers.get("authorization"),process.env.CRON_SECRET))return reply({error:"Unauthorized job request."},401);
 try{
  const client=createWorkerClient(),today=londonDate(),errors:string[]=[],standing:unknown[]=[];
  const {data:orders,error:ordersError}=await client.from("standing_orders").select("block_id").eq("enabled",true);
  if(ordersError)errors.push("Standing-order configuration is unavailable.");
  for(const blockId of [...new Set((orders??[]).map(row=>row.block_id))]){const {data,error}=await client.rpc("process_standing_orders",{p_block_id:blockId,p_today:today});if(error)errors.push(`Standing-order processing failed for block ${blockId}.`);else standing.push({blockId,result:data});}
  const {data:alerts,error:alertError}=await client.rpc("create_management_review_alerts",{p_today:today});if(alertError)errors.push("Consultation review alerts could not be generated.");
  let dispatches:unknown[]=[];
  if(process.env.LONDON_DELIVERY_ENABLED==="1")dispatches=await processManagementDispatches(client,{enabled:true,apiKey:process.env.RESEND_API_KEY,from:process.env.RESEND_FROM_EMAIL,replyTo:process.env.RESEND_REPLY_TO_EMAIL});
  return reply({standing,alerts:alerts??0,dispatches,deliveryEnabled:process.env.LONDON_DELIVERY_ENABLED==="1",errors},errors.length?207:200);
 }catch(error){return reply({error:error instanceof Error?error.message:"Job processing failed."},503);}
}
