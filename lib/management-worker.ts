import type {SupabaseClient} from "@supabase/supabase-js";
import {runDispatchJobs,sendResendEnvelope,type DispatchRecord} from "./management-dispatch.ts";
export async function processManagementDispatches(client:SupabaseClient,config:Parameters<typeof sendResendEnvelope>[1],blockId?:number,fetcher:typeof fetch=fetch){
 if(!config.enabled)throw new Error("Email delivery is disabled.");
 if(!config.apiKey||!config.from)throw new Error("The reviewed sender is not configured.");
 const completed:{key:string;status:string}[]=[];const deadline=Date.now()+70000;
 while(completed.length<100&&Date.now()<deadline-17000){
 const batch=await runDispatchJobs({claim:async(at,id)=>{const {data,error}=await client.rpc("claim_management_dispatches",{p_at:at,p_block_id:id??null});if(error)throw new Error("Dispatch queue could not be claimed.");return (data??[]) as DispatchRecord[];},finish:async(row,result)=>{const {error}=await client.rpc("finish_management_dispatch",{p_key:row.idempotency_key,p_token:row.claim_token,p_status:result.status,p_provider_id:result.status==="Sent"?result.providerMessageId:null,p_evidence:result.evidence});if(error)throw new Error("Provider outcome was not saved. Submission remains claimed; reconcile before any retry.");}},envelope=>sendResendEnvelope(envelope,config,fetcher),new Date().toISOString(),blockId);
 if(!batch.length)break;completed.push(...batch);
 await new Promise(resolve=>setTimeout(resolve,500));
 }
 return completed;
}
