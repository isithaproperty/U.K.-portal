import type {SupabaseClient} from "@supabase/supabase-js";
import {isBulkReminderKind} from "./bulk-reminder-queue.ts";
import {runDispatchJobs,sendResendEnvelope,type DispatchRecord} from "./management-dispatch.ts";
export async function processManagementDispatches(client:SupabaseClient,config:Parameters<typeof sendResendEnvelope>[1]&{bulkEnabled?:boolean},blockId?:number,fetcher:typeof fetch=fetch){
 if(!config.enabled)throw new Error("Email delivery is disabled.");
 if(!config.apiKey||!config.from)throw new Error("The reviewed sender is not configured.");
 const completed:{key:string;status:string}[]=[];const deadline=Date.now()+70000;
 while(completed.length<100&&Date.now()<deadline-17000){
 const batch=await runDispatchJobs({claim:async(at,id)=>{const {data,error}=await client.rpc("claim_management_dispatches",{p_at:at,p_block_id:id??null});if(error)throw new Error("Dispatch queue could not be claimed.");if(data?.length||!config.bulkEnabled)return (data??[]) as DispatchRecord[];const bulk=await client.rpc("claim_bulk_reminder_dispatches",{p_at:at,p_block_id:id??null});if(bulk.error)throw new Error("Bulk reminder queue could not be claimed. Check the reviewed migration.");return (bulk.data??[]) as DispatchRecord[];},finish:async(row,result)=>{const {error}=await client.rpc("finish_management_dispatch",{p_key:row.idempotency_key,p_token:row.claim_token,p_status:result.status,p_provider_id:result.status==="Sent"?result.providerMessageId:null,p_evidence:result.evidence});if(error)throw new Error("Provider outcome was not saved. Submission remains claimed; reconcile before any retry.");}},async(envelope,row)=>{
  if(isBulkReminderKind(envelope.kind)){
   if(!config.bulkEnabled)return {status:"Failed",evidence:"Bulk reminder transport is disabled; no provider request was made."};
   const validationStarted=performance.now();
   const {data:allowed,error}=await client.rpc("verify_bulk_reminder_submission",{p_key:row.idempotency_key,p_token:row.claim_token});
   if(error||allowed!==true||performance.now()-validationStarted>10000)return {status:"Failed",evidence:"Bulk reminder ledger, recipient, approval or submission lease changed. No provider request was made; review the account."};
  }
  return sendResendEnvelope(envelope,config,fetcher);
 },new Date().toISOString(),blockId);
 if(!batch.length)break;completed.push(...batch);
 await new Promise(resolve=>setTimeout(resolve,500));
 }
 return completed;
}
