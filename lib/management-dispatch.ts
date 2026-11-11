import {timingSafeEqual} from "node:crypto";
import type {DeliveryEnvelope} from "./management-delivery.ts";
export type DispatchOutcome={status:"Sent";providerMessageId:string;evidence:string}|{status:"Failed"|"Uncertain";providerMessageId?:never;evidence:string};
export type DispatchRecord={idempotency_key:string;block_id:number;unit_id:number|null;kind:string;envelope:DeliveryEnvelope;claim_token:string;status:string;sent_at?:string|null;scheduled_at:string};
export type DispatchStore={claim:(at:string,blockId?:number)=>Promise<DispatchRecord[]>;finish:(row:DispatchRecord,result:DispatchOutcome)=>Promise<void>};
export async function sendResendEnvelope(envelope:DeliveryEnvelope,config:{enabled:boolean;apiKey?:string;from?:string;replyTo?:string},fetcher:typeof fetch=fetch):Promise<DispatchOutcome>{
 if(!config.enabled)throw new Error("Email delivery is disabled.");
 if(!config.apiKey||!config.from)throw new Error("The reviewed sender connection is incomplete.");
 if(!/^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(envelope.to)||!envelope.subject.trim()||/[\r\n\0]/.test(envelope.subject)||!envelope.body.trim()||!envelope.idempotencyKey.startsWith("mgmt-v1-")||!Array.isArray(envelope.attachments)||!envelope.attachments.length)throw new Error("Invalid immutable delivery envelope.");
 const attachments=envelope.attachments.map(a=>{if(!a.fileName||/[\r\n\0/\\]/.test(a.fileName)||!a.content||!["utf8","base64"].includes(a.encoding)||!["text/plain","application/pdf"].includes(a.mediaType))throw new Error("Invalid document attachment.");return {filename:a.fileName,content:a.encoding==="base64"?a.content:Buffer.from(a.content,"utf8").toString("base64"),content_type:a.mediaType};});
 try{
  const response=await fetcher("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json","Idempotency-Key":envelope.idempotencyKey},body:JSON.stringify({from:config.from,to:[envelope.to],subject:envelope.subject,text:envelope.body,attachments,...(config.replyTo?{reply_to:config.replyTo}:{})}),signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>null);
  if(response.ok&&typeof body?.id==="string"&&body.id)return {status:"Sent",providerMessageId:body.id,evidence:"Provider accepted this exact message; delivery is not yet established."};
  if([400,401,403,404,422,429].includes(response.status))return {status:"Failed",evidence:`Provider rejected this submission (HTTP ${response.status}); no automatic retry.`};
  return {status:"Uncertain",evidence:`Provider acceptance could not be established (HTTP ${response.status}). Reconcile before resending.`};
 }catch{return {status:"Uncertain",evidence:"Transport failed or timed out. Provider acceptance is unknown; reconcile before resending."};}
}
export async function runDispatchJobs(store:DispatchStore,send:(envelope:DeliveryEnvelope)=>Promise<DispatchOutcome>,at:string,blockId?:number){
 if(!Number.isFinite(Date.parse(at)))throw new Error("A valid job time is required.");
 const rows=await store.claim(at,blockId),results:{key:string;status:string}[]=[];
 for(const row of rows){
  let outcome:DispatchOutcome;
  try{outcome=await send(row.envelope);}catch{outcome={status:"Uncertain",evidence:"Worker could not establish transport outcome; manager reconciliation required."};}
  await store.finish(row,outcome);results.push({key:row.idempotency_key,status:outcome.status});
 }
 return results;
}
export function verifyCronAuthorization(header:string|null,secret:string|undefined){if(!secret||secret.length<20||!header)return false;const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(header);return actual.length===expected.length&&timingSafeEqual(actual,expected);}
