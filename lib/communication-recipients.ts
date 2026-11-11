export const communicationAudiences=["legacy-residents","saved-contacts"] as const;
export type CommunicationAudience=typeof communicationAudiences[number];
export type CommunicationResident={id:number;block_id:number;email:string;archived_at?:string|null};
export type CommunicationRecipient={email:string;blockIds:number[]};
export type ResidentCommunicationSnapshot={resident_id:number;block_id:number;email:string};
export function isCommunicationAudience(value:unknown):value is CommunicationAudience{return communicationAudiences.includes(value as CommunicationAudience);}
function email(value:unknown){if(typeof value!=="string")throw new Error("Invalid communication email.");const result=value.trim().toLowerCase();if(result.length>254||!/^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(result))throw new Error("Invalid communication email.");return result;}
/** Shared by the manager preview and sender; saved contacts never create portal assignments. */
export function resolveCommunicationRecipients(blockId:number,audience:CommunicationAudience,residents:CommunicationResident[],contactState:unknown){
 if(!Number.isSafeInteger(blockId)||blockId<1||!isCommunicationAudience(audience))throw new Error("Select a valid block and communication audience.");
 const addresses=new Set<string>();
 if(audience==="legacy-residents")for(const resident of residents){if(resident.block_id===blockId&&!resident.archived_at)addresses.add(email(resident.email));}
 else {
  if(contactState!==null){
   if(!contactState||typeof contactState!=="object"||Array.isArray(contactState)||!Array.isArray((contactState as {contacts?:unknown}).contacts))throw new Error("Saved contacts could not be verified.");
   for(const raw of (contactState as {contacts:unknown[]}).contacts){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Saved contact is invalid.");const c=raw as Record<string,unknown>;
    if(c.blockId!==blockId)throw new Error("Saved contact is outside the selected block.");
    if(!["Leaseholder","Tenant","Recognised association"].includes(String(c.role)))throw new Error("Classify saved contacts before communicating.");
    if(c.communications!==true)continue;
    if(!Array.isArray(c.emails)||!c.emails.length||c.emails.length>10)throw new Error("Saved contact email list is invalid.");
    for(const address of c.emails)addresses.add(email(address));
   }
  }
 }
 const recipients=[...addresses].sort().map(address=>({email:address,blockIds:[blockId]}));
 const residentSnapshot=residents.filter(r=>r.block_id===blockId&&!r.archived_at&&addresses.has(email(r.email))).map(r=>({resident_id:r.id,block_id:r.block_id,email:email(r.email)})).sort((a,b)=>a.resident_id-b.resident_id);
 return {recipients,residentSnapshot};
}
export function combineCommunicationRecipients(groups:{recipients:CommunicationRecipient[];residentSnapshot:ResidentCommunicationSnapshot[]}[]){
 const emails=new Map<string,Set<number>>(),assignments=new Map<string,ResidentCommunicationSnapshot>();
 for(const group of groups){for(const recipient of group.recipients){const blocks=emails.get(recipient.email)??new Set<number>();for(const blockId of recipient.blockIds)blocks.add(blockId);emails.set(recipient.email,blocks);}for(const r of group.residentSnapshot)assignments.set(`${r.block_id}/${r.resident_id}`,r);}
 return {recipients:[...emails].sort(([a],[b])=>a.localeCompare(b)).map(([email,blocks])=>({email,blockIds:[...blocks].sort((a,b)=>a-b)})),residentSnapshot:[...assignments.values()].sort((a,b)=>a.block_id-b.block_id||a.resident_id-b.resident_id)};
}
export async function communicationFingerprint(value:unknown){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");}
export function validCommunicationRequestId(value:unknown):value is string{return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
export function canReplayCommunication(createdAt:string,now:number){const created=Date.parse(createdAt);return Number.isFinite(created)&&now>=created&&now-created<23*60*60*1000;}

export type PrivateCommunicationEmail={from:string;to:string[];subject:string;html:string;reply_to?:string;tags:{name:string;value:string}[]};
/** Dependency-injected provider adapter, exercised with mocked fetch; never groups private addresses. */
export async function deliverCommunicationBatch(emails:PrivateCommunicationEmail[],requestId:string,batchIndex:number,apiKey:string,fetcher:typeof fetch=fetch){
 if(!validCommunicationRequestId(requestId)||!Number.isSafeInteger(batchIndex)||batchIndex<0||!emails.length||emails.length>100||emails.some(e=>e.to.length!==1))throw new Error("Invalid private communication batch.");
 const response=await fetcher("https://api.resend.com/emails/batch",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`resident-communication/${requestId}/${batchIndex}`},body:JSON.stringify(emails),signal:AbortSignal.timeout(25000)});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(`Email provider rejected the batch (${response.status}). Retry this same communication request; do not create a new request.`);
 const ids=Array.isArray(body?.data)?body.data.map((row:{id?:unknown})=>typeof row.id==="string"?row.id:""):[];
 if(ids.length!==emails.length||ids.some((id:string)=>!id))throw new Error("Email provider response was incomplete. Keep the same request for outcome verification.");
 return ids as string[];
}
