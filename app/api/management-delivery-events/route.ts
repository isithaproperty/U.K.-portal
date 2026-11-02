export const maxDuration=30;
import {NextRequest,NextResponse} from "next/server";
import {verifyManagementWebhook} from "../../../lib/management-webhook";
import {createWorkerClient} from "../../../lib/supabase/worker";
export async function POST(request:NextRequest){
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status});
 if(process.env.LONDON_DELIVERY_ENABLED!=="1"||!process.env.RESEND_WEBHOOK_SECRET)return reply({error:"Delivery-event processing is disabled."},503);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>200000)return reply({error:"Payload too large."},413);
 const id=request.headers.get("svix-id");if(!verifyManagementWebhook(raw,{id,timestamp:request.headers.get("svix-timestamp"),signature:request.headers.get("svix-signature")},process.env.RESEND_WEBHOOK_SECRET))return reply({error:"Invalid event signature."},400);
 let event;try{event=JSON.parse(raw);}catch{return reply({error:"Invalid event."},400);}
 if(!["email.delivered","email.bounced"].includes(event.type))return reply({ignored:true});
 if(typeof event.data?.email_id!=="string"||!event.data.email_id||typeof event.created_at!=="string"||!Number.isFinite(Date.parse(event.created_at)))return reply({error:"Invalid provider event."},400);
 try{const {data,error}=await createWorkerClient().rpc("record_management_delivery_event",{p_event_id:id,p_provider_id:event.data.email_id,p_event:event.type,p_at:event.created_at});if(error)return reply({error:"Event storage failed; provider may retry."},503);return reply({recorded:data});}catch{return reply({error:"Event service unavailable."},503);}
}
