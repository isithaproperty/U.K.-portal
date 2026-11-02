
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

import {resolveCommunicationRecipients,combineCommunicationRecipients,communicationFingerprint,isCommunicationAudience,validCommunicationRequestId,canReplayCommunication,deliverCommunicationBatch,type PrivateCommunicationEmail} from "../../../lib/communication-recipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function emailHtml(subject: string, message: string, blockNames: string[]) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(subject)}</title></head><body style="margin:0;background:#f6f3ed;font-family:Arial,sans-serif;color:#1b1814">
  <div style="max-width:640px;margin:0 auto;padding:28px 18px">
    <div style="background:#15120f;color:#d4af37;padding:22px 26px;border-radius:12px 12px 0 0">
      <div style="font-size:12px;letter-spacing:1.5px;font-weight:700">AVIAF ASSET MANAGEMENT</div>
      <h1 style="margin:8px 0 0;font-size:24px;color:#fff">${esc(subject)}</h1>
    </div>
    <div style="background:#fff;padding:26px;border:1px solid #e4dccf;border-top:0;border-radius:0 0 12px 12px">
      <p>Hello,</p>
      <p>${esc(message).replaceAll("\n","<br>")}</p>
      <p>Regards,<br>AVIAF Asset Management</p>
      <hr style="border:none;border-top:1px solid #e8e0d3;margin:26px 0">
      <p style="font-size:12px;color:#766f64;margin:0">This communication relates to: ${blockNames.map(esc).join(", ")}.</p>
    </div>
  </div></body></html>`;
}

Deno.serve(async (req: Request) => {
 if(req.method === "OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return json({error:"Unauthorized"},401);
 const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
 let secretKeys:Record<string,string>={};try{secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");}catch{return json({error:"Server configuration missing"},500);}
 const secretKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!secretKey)return json({error:"Server configuration missing"},500);
 const admin=createClient(supabaseUrl,secretKey,{auth:{persistSession:false}});
 const {data:userData,error:userError}=await admin.auth.getUser(token),user=userData?.user;
 if(userError||!user?.email)return json({error:"Unauthorized"},401);
 const callerEmail=user.email.toLowerCase();
 const {data:member,error:memberError}=await admin.from("portal_members").select("role,portfolio_manager").eq("email",callerEmail).maybeSingle();
 if(memberError||!member||!["owner","admin","manager"].includes(member.role))return json({error:"Forbidden"},403);
 let payload:any;try{const raw=await req.text();if(new TextEncoder().encode(raw).length>250000)return json({error:"Communication request is too large."},413);payload=JSON.parse(raw);}catch{return json({error:"Invalid communication request."},400);}
 if(!payload||typeof payload!=="object"||Array.isArray(payload))return json({error:"Invalid communication request."},400);
 const subject=typeof payload.subject==="string"?payload.subject.trim():"",message=typeof payload.message==="string"?payload.message.trim():"";
 const audience=payload.audience,requestId=payload.requestId;
 if(!isCommunicationAudience(audience)||!validCommunicationRequestId(requestId))return json({error:"Select an audience and use one stable communication request ID."},400);
 if(!Array.isArray(payload.blockIds)||payload.blockIds.some((id:unknown)=>!Number.isSafeInteger(id)||Number(id)<1))return json({error:"Invalid selected blocks."},400);
 const blockIds:number[]=[...new Set<number>(payload.blockIds)].sort((a,b)=>a-b);
 if(!subject||/[\r\n]/.test(subject)||subject.length>200||!message||message.length>10000||!blockIds.length||blockIds.length>500)return json({error:"Use 1–500 blocks, a subject up to 200 characters and a message up to 10,000 characters."},400);
 const fingerprints=payload.previewFingerprints;
 if(!fingerprints||typeof fingerprints!=="object"||Array.isArray(fingerprints)||blockIds.some(id=>typeof fingerprints[id]!=="string"||!/^[0-9a-f]{64}$/.test(fingerprints[id])))return json({error:"Load and review the current server recipient preview before sending."},400);
 const {data:blockRows,error:blockError}=await admin.from("blocks").select("id,name,manager").in("id",blockIds);
 if(blockError||!blockRows||blockRows.length!==blockIds.length)return json({error:"Selected blocks could not be verified."},400);
 if(member.role==="manager"&&(!member.portfolio_manager||blockRows.some((b:any)=>b.manager!==member.portfolio_manager)))return json({error:"You can only communicate with blocks in your own portfolio."},403);
 const requestHash=await communicationFingerprint({subject,message,audience,blockIds,previewFingerprints:blockIds.map(id=>[id,fingerprints[id]])});
 const {data:prior,error:priorError}=await admin.from("communication_delivery_requests").select("*").eq("request_id",requestId).maybeSingle();
 if(priorError)return json({error:"Communication retry storage is unavailable. Install the reviewed delivery migration before sending."},503);
 let delivery:any=prior;
 if(delivery&&(delivery.sent_by!==callerEmail||delivery.payload_hash!==requestHash))return json({error:"This request ID belongs to a different communication. Do not reuse it for edited content or recipients."},409);
 if(delivery?.status==="sent")return json({ok:true,recipientCount:delivery.recipient_count,blockCount:delivery.block_count,replayed:true});
 if(!delivery){
  const residentRows:any[]=[];
  for(let offset=0;offset<=10000;offset+=1000){const {data,error}=await admin.from("residents").select("id,email,block_id").is("archived_at",null).in("block_id",blockIds).order("id").range(offset,offset+999);if(error)return json({error:"Resident recipients could not be loaded."},503);residentRows.push(...(data??[]));if((data??[]).length<1000)break;if(offset===10000)return json({error:"Select fewer blocks; this communication exceeds 10,000 resident assignments."},400);}
  let contactRows:any[]=[];
  if(audience==="saved-contacts"){
   const {data,error}=await admin.from("management_review_state").select("block_id,state,revision").eq("area","leaseholders").in("block_id",blockIds);
   if(error)return json({error:"Saved contact storage is unavailable; no emails were sent."},503);contactRows=data??[];
  }
  const groups=[];
  try{for(const blockId of blockIds){const saved=contactRows.find(row=>row.block_id===blockId),resolved=resolveCommunicationRecipients(blockId,audience,residentRows,saved?.state??null),fingerprint=await communicationFingerprint({blockId,audience,revision:saved?.revision??0,...resolved});if(fingerprint!==fingerprints[blockId])return json({error:"Recipients changed after preview. Refresh the recipient preview and review it again before sending.",previewChanged:true},409);groups.push(resolved);}}catch(error){return json({error:error instanceof Error?error.message:"Recipients could not be verified."},400);}
  const resolved=combineCommunicationRecipients(groups);
  if(!resolved.recipients.length)return json({error:"No eligible emails in this audience. Save contact records or choose registered resident assignments."},400);
  if(resolved.recipients.length>10000)return json({error:"Select fewer blocks; this communication exceeds 10,000 email addresses."},400);
  const from=Deno.env.get("RESEND_FROM_EMAIL"),replyTo=Deno.env.get("RESEND_REPLY_TO_EMAIL");
  if(!Deno.env.get("RESEND_API_KEY")||!from)return json({error:"Email is not configured yet",missing:[!Deno.env.get("RESEND_API_KEY")?"RESEND_API_KEY":null,!from?"RESEND_FROM_EMAIL":null].filter(Boolean)},503);
  const emails:PrivateCommunicationEmail[]=resolved.recipients.map(recipient=>({from,to:[recipient.email],subject,html:emailHtml(subject,message,blockRows.filter((b:any)=>recipient.blockIds.includes(b.id)).map((b:any)=>b.name).sort()),...(replyTo?{reply_to:replyTo}:{}),tags:[{name:"category",value:"resident_communication"}]}));
  const frozen={subject,message,blockIds,audience,emails,residentSnapshot:resolved.residentSnapshot};
  const {data:created,error:createError}=await admin.from("communication_delivery_requests").insert({request_id:requestId,sent_by:callerEmail,payload_hash:requestHash,delivery_payload:frozen,recipient_count:emails.length,block_count:blockIds.length}).select("*").single();
  if(createError){if(createError.code!=="23505")return json({error:"Could not reserve a durable communication request. No provider request was made."},503);const {data,error}=await admin.from("communication_delivery_requests").select("*").eq("request_id",requestId).single();if(error||!data||data.sent_by!==callerEmail||data.payload_hash!==requestHash)return json({error:"Communication request conflict. Reload to verify the outcome."},409);delivery=data;}else delivery=created;
 }
 if(delivery.status==="sent")return json({ok:true,recipientCount:delivery.recipient_count,blockCount:delivery.block_count,replayed:true});
 const {data:published,error:publishedError}=await admin.from("communications").select("id").eq("delivery_request_id",requestId).maybeSingle();
 if(publishedError)return json({error:"Could not verify earlier communication completion. No retry was attempted."},503);
 if(published){await admin.from("communication_delivery_requests").update({status:"sent",completed_at:new Date().toISOString()}).eq("request_id",requestId);return json({ok:true,recipientCount:delivery.recipient_count,blockCount:delivery.block_count,replayed:true});}
 if(!canReplayCommunication(delivery.created_at,Date.now()))return json({error:"This communication has an unresolved outcome outside the safe provider retry window. A manager must reconcile provider history; no emails were retried.",uncertain:true},409);
 const resendKey=Deno.env.get("RESEND_API_KEY");if(!resendKey)return json({error:"Email provider configuration is missing. Retain this same request ID."},503);
 const frozen=delivery.delivery_payload;
 const resendIds:string[]=[];
 try{for(let i=0;i<frozen.emails.length;i+=100)resendIds.push(...await deliverCommunicationBatch(frozen.emails.slice(i,i+100),requestId,i/100,resendKey));}
 catch(error){return json({error:error instanceof Error?error.message:"Provider outcome is uncertain. Retry this same communication request within the safe retry window.",requestId,uncertain:true},502);}
 const {error:saveError}=await admin.from("communications").insert({subject:frozen.subject,message:frozen.message,block_ids:frozen.blockIds,recipient_count:delivery.recipient_count,recipient_snapshot:frozen.residentSnapshot,status:"sent",sent_by:callerEmail,resend_ids:resendIds,error_message:null,delivery_request_id:requestId});
 if(saveError&&saveError.code!=="23505")return json({error:"Emails were accepted, but the resident portal copy could not be saved. Retain and retry this same request; do not compose a new send.",emailSent:true,portalSaved:false,requestId},500);
 const {error:completeError}=await admin.from("communication_delivery_requests").update({status:"sent",completed_at:new Date().toISOString()}).eq("request_id",requestId);
 if(completeError)return json({error:"Emails and portal copies were recorded, but completion could not be confirmed. Keep this request ID for a safe outcome check.",emailSent:true,requestId},503);
 return json({ok:true,recipientCount:delivery.recipient_count,blockCount:delivery.block_count});
});
