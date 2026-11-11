import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import type {DeliveryEnvelope} from "./management-delivery";
import type {BulkReminderPreview} from "./bulk-reminders";
export const isBulkReminderKind=(kind:string)=>["Overdue account reminder","Friendly balance notice"].includes(kind);
type Approval={actor:string;blockId:number;fingerprint:string;previewToken:string;expiresAt:number};
/** Server-only exact-message proof. No new secret/configuration is created. */
export function signBulkReminderApproval(approval:Approval,secret:string){
 if(!secret||secret.length<20)throw Error("Secure batch approval is not configured.");
 const payload=Buffer.from(JSON.stringify(approval)).toString("base64url");
 return `${payload}.${createHmac("sha256",secret).update(payload).digest("base64url")}`;
}
export function verifyBulkReminderApproval(token:unknown,expected:Omit<Approval,"expiresAt">,secret:string,now=Date.now()){
 if(typeof token!=="string"||token.length>4000||!secret||secret.length<20)throw Error("Preview and approve the exact batch again.");
 const [payload,signature,extra]=token.split(".");
 const actual=Buffer.from(signature??""),wanted=Buffer.from(createHmac("sha256",secret).update(payload??"").digest("base64url"));
 if(extra!==undefined||actual.length!==wanted.length||!timingSafeEqual(actual,wanted))throw Error("Preview approval could not be verified.");
 let data:Approval;try{data=JSON.parse(Buffer.from(payload,"base64url").toString());}catch{throw Error("Invalid preview approval.");}
 if(!Number.isSafeInteger(data.expiresAt)||data.expiresAt<now||data.expiresAt>now+10*60*1000||Object.entries(expected).some(([key,value])=>data[key as keyof Approval]!==value))throw Error("Preview expired or the exact batch changed. Refresh and approve again.");
}
export type BulkQueuedEnvelope=DeliveryEnvelope&{sourceEvidence:{contactRevision:number;bulkReminder:{ledgerRevision:string;asOf:string;mode:string;fingerprint:string;previewToken:string;statement:BulkReminderPreview["messages"][number]["statement"]}}};
export async function bulkReminderEnvelopes(preview:BulkReminderPreview):Promise<BulkQueuedEnvelope[]>{
 const {snapshot}=preview;
 if(!snapshot.ledgerRevision||!/^\d+$/.test(snapshot.ledgerRevision))throw Error("Install the reviewed bulk reminder migration before queueing.");
 const ledgerRevision=snapshot.ledgerRevision;
 return Promise.all(preview.messages.map(async message=>{
  if(message.blockId!==snapshot.blockId||!snapshot.accounts.some(a=>a.unitId===message.unitId&&a.eligible&&a.recipients.includes(message.to))||!isBulkReminderKind(message.kind)||!/^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(message.to))throw Error("Private recipient scope could not be verified.");
  if(message.attachments?.length!==1||message.attachments[0].mediaType!=="application/pdf"||message.attachments[0].encoding!=="base64"||message.statement?.blockId!==message.blockId||message.statement.unitId!==message.unitId||message.statement.asOf!==snapshot.asOf)throw Error("Review the exact private account statement before queueing.");
  const decoded=Buffer.from(message.attachments[0].content,"base64");
  if(decoded.length>2_000_000||decoded.subarray(0,5).toString()!=="%PDF-"||createHash("sha256").update(decoded).digest("hex")!==message.statement.sha256)throw Error("Private statement content could not be verified.");
  const messageDigest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(message))));
  const perMessageToken=Array.from(messageDigest,b=>b.toString(16).padStart(2,"0")).join("");
  const operationDigest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({perMessageToken,fingerprint:snapshot.fingerprint}))));
  const operationHash=Array.from(operationDigest,b=>b.toString(16).padStart(2,"0")).join("");
  const exact={operationId:`bulk-reminder:${snapshot.asOf}:${operationHash.slice(0,40)}`,kind:message.kind,blockId:message.blockId,unitId:message.unitId,to:message.to,subject:message.subject,body:message.body,attachments:message.attachments,sourceEvidence:{contactRevision:snapshot.contactRevision,bulkReminder:{ledgerRevision,asOf:snapshot.asOf,mode:snapshot.mode,fingerprint:snapshot.fingerprint,previewToken:perMessageToken,statement:message.statement}}};
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(exact))));
  return {...exact,idempotencyKey:`mgmt-v1-${Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}`};
 }));
}
