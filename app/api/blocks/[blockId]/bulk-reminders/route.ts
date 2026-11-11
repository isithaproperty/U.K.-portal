import {NextRequest} from "next/server";
import {managementAccess,managementReply as reply} from "../../../../../lib/management-access";
import {buildBulkReminderSnapshot,prepareBulkReminderPreview,type BulkReminderMode} from "../../../../../lib/bulk-reminders";
import {bulkReminderEnvelopes,signBulkReminderApproval,verifyBulkReminderApproval} from "../../../../../lib/bulk-reminder-queue";
import {createWorkerClient} from "../../../../../lib/supabase/worker";
import type {Block} from "../../../../types";
type Context={params:Promise<{blockId:string}>};
export async function POST(request:NextRequest,context:Context){
 const access=await managementAccess(Number((await context.params).blockId));if(access.response)return access.response;
 const {client,block,user}=access;
 try{
  const raw=await request.text();if(new TextEncoder().encode(raw).length>20000)return reply({error:"Batch request is too large."},413);
  const body=JSON.parse(raw),queue=body?.action==="queue";
  if(body?.action==="recover-expired"){
   if(body.approved!==true)return reply({error:"Explicit approval is required to recover expired submission claims."},400);
   const {data:recovered,error}=await createWorkerClient().rpc("recover_bulk_reminder_claims",{p_block_id:block.id});
   if(error)return reply({error:"Recovery outcome unconfirmed. Reload queue history before retrying."},409);
   return reply({recovered,emailSent:false,message:"Expired bulk submissions were marked uncertain for reconciliation. No messages were sent or retried."});
  }
  if(!body||!["accounts","messages","queue"].includes(body.action)||!["overdue","outstanding"].includes(body.mode)||(queue?(body.approved!==true||body.preview===true):(body.preview!==true||body.approved!==undefined)))return reply({error:"Preview exact messages first, then explicitly approve queueing that batch."},400);
  // One manager-authorized database snapshot; revision/locks close the old count-only read race.
  const {data:source,error}=await client.rpc("read_bulk_reminder_snapshot",{p_block_id:block.id});
  if(error||!source)return reply({error:"Complete bulk reminder snapshot unavailable. The reviewed bulk reminder migration must be installed before use."},503);
  if(source.block?.id!==block.id||!Array.isArray(source.protectedRecipients)||typeof source.ledgerRevision!=="string"||!/^\d+$/.test(source.ledgerRevision))throw Error("Building snapshot revision could not be verified.");
  const snapshot=await buildBulkReminderSnapshot({block:source.block as Block,units:source.units,entries:source.entries,contactState:source.contactState,contactRevision:source.contactRevision,protectedRecipients:source.protectedRecipients,ledgerRevision:source.ledgerRevision,asOf:source.asOf,generatedAt:source.generatedAt,mode:body.mode as BulkReminderMode});
  const deliveryEnabled=process.env.LONDON_DELIVERY_ENABLED==="1"&&process.env.LONDON_BULK_REMINDER_DELIVERY_ENABLED==="1";
  if(body.action==="accounts")return reply({snapshot,previewOnly:true,emailSent:false,queued:0,deliveryEnabled});
  if(body.snapshotToken!==snapshot.fingerprint)return reply({error:"Ledger or contacts changed. Refresh accounts and review the selection again."},409);
  const preview=await prepareBulkReminderPreview(snapshot,{unitIds:body.unitIds,subject:body.subject,message:body.message,snapshotToken:body.snapshotToken});
  const approval={actor:user.email!.toLowerCase(),blockId:block.id,fingerprint:snapshot.fingerprint,previewToken:preview.previewToken};
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY??"";
  if(!queue){const expiresAt=Date.now()+10*60*1000;return reply({...preview,approvalToken:secret.length>=20?signBulkReminderApproval({...approval,expiresAt},secret):null,expiresAt,queueAvailable:secret.length>=20,previewOnly:true,emailSent:false,queued:0,deliveryEnabled});}
  verifyBulkReminderApproval(body.approvalToken,approval,secret);
  const envelopes=await bulkReminderEnvelopes(preview);
  const rows=envelopes.map(envelope=>({idempotency_key:envelope.idempotencyKey,block_id:block.id,unit_id:envelope.unitId,operation_id:envelope.operationId,kind:envelope.kind,recipient:envelope.to,envelope,scheduled_at:new Date().toISOString()}));
  const {data:result,error:queueError}=await createWorkerClient().rpc("queue_bulk_reminder_dispatches",{p_rows:rows,p_actor:approval.actor,p_revision:snapshot.ledgerRevision,p_as_of:snapshot.asOf});
  if(queueError)return reply({error:"Batch queueing was not confirmed. Check Delivery queue & exact history before retrying. The ledger/contacts may have changed or these accounts may already have a reminder today."},409);
  // Return actual immutable record states, not a claim that retry rows are newly queued.
  const records:unknown[]=[];let historyError=false;
  for(let offset=0;offset<envelopes.length;offset+=50){
   const keys=envelopes.slice(offset,offset+50).map(e=>e.idempotencyKey);
   const result=await client.from("management_dispatches").select("idempotency_key,unit_id,recipient,status,sent_at,delivery_status").eq("block_id",block.id).in("idempotency_key",keys);
   if(result.error||!Array.isArray(result.data)||result.data.length!==keys.length||new Set(result.data.map(r=>r.idempotency_key)).size!==keys.length||result.data.some(r=>!keys.includes(r.idempotency_key))){historyError=true;break;}
   records.push(...result.data);
  }
  return reply({accepted:result,records,historyWarning:historyError?"Batch accepted, but current statuses could not be read. Reload Delivery queue & exact history before any retry.":null,emailSent:false,deliveryEnabled,message:"Exact messages accepted by the queue. This action did not contact the email provider. Existing records are not resent by a retry."});
 }catch(error){return reply({error:error instanceof Error?error.message:"Bulk reminder action unavailable."},400);}
}
