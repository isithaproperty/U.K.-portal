export const maxDuration=120;
import {NextRequest} from "next/server";
import {managementAccess,managementReply as reply} from "../../../../../lib/management-access";
import {validateFinancialState,financialDraftToLedgerRows} from "../../../../../lib/financial-planning";
import {generateFinancialDocuments,type FinancialDocumentInput} from "../../../../../lib/management-documents";
import {validateDebtorState} from "../../../../../lib/debtors";
import {validateLeaseholderState,contactRecipients,assertConsultationDispatchReady} from "../../../../../lib/leaseholder-planning";
import {prepareDeliveryEnvelopes,type DeliveryEnvelope} from "../../../../../lib/management-delivery";
import {londonDate} from "../../../../../lib/service-charges";
import {createWorkerClient,WorkerConfigurationError} from "../../../../../lib/supabase/worker";
import {processManagementDispatches} from "../../../../../lib/management-worker";
type Context={params:Promise<{blockId:string}>};
export async function GET(_request:NextRequest,context:Context){
 const access=await managementAccess(Number((await context.params).blockId));if(access.response)return access.response;const {client,block}=access;
 const results=await Promise.all([client.from("management_dispatches").select("*").eq("block_id",block.id).order("scheduled_at",{ascending:false}).limit(500),client.from("management_review_state").select("area,state,revision").eq("block_id",block.id).in("area",["financials","debtors","leaseholders"]),client.from("management_manager_alerts").select("*").eq("block_id",block.id).order("review_date",{ascending:false}).limit(100),client.from("management_dispatch_events").select("dispatch_key,at,event,detail").eq("block_id",block.id).order("at",{ascending:false}).limit(1000)]);
 if(results.some(r=>r.error))return reply({error:"Dispatch history or review storage is unavailable; review migrations must be installed."},503);
 const states=results[1].data??[],find=(area:string)=>states.find(s=>s.area===area);
 return reply({records:results[0].data,financial:find("financials")?.state?.prepared?.input??null,reminders:find("debtors")?.state?.history??[],consultations:find("leaseholders")?.state?.consultations??[],alerts:results[2].data,events:results[3].data,deliveryEnabled:process.env.LONDON_DELIVERY_ENABLED==="1"});
}
export async function POST(request:NextRequest,context:Context){
 const access=await managementAccess(Number((await context.params).blockId));if(access.response)return access.response;const {client,block,user}=access;
 let body:Record<string,unknown>;
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>30000)throw Error("Dispatch request is too large.");body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))throw Error("Invalid request.");}catch(error){return reply({error:error instanceof Error?error.message:"Invalid dispatch request."},400);}
 if(body.action==="Process due"){
  if(process.env.LONDON_DELIVERY_ENABLED!=="1")return reply({error:"Email delivery is disabled. No messages were sent."},503);
  if(body.approved!==true)return reply({error:"Explicit delivery approval is required."},400);
  try{return reply({processed:await processManagementDispatches(createWorkerClient(),{enabled:true,apiKey:process.env.RESEND_API_KEY,from:process.env.RESEND_FROM_EMAIL,replyTo:process.env.RESEND_REPLY_TO_EMAIL},block.id)});}catch(error){return reply({error:error instanceof Error?error.message:"Dispatch processing failed."},503);}
 }
 if(["Cancel","Retry","Reconcile accepted","Reconcile not accepted"].includes(String(body.action))){
  if(typeof body.key!=="string"||typeof body.evidence!=="string"||body.evidence.trim().length<10)return reply({error:"Select a record and provide authoritative evidence."},400);
  const {data:record,error}=await client.from("management_dispatches").select("idempotency_key").eq("block_id",block.id).eq("idempotency_key",body.key).maybeSingle();if(error||!record)return reply({error:"Dispatch unavailable in this block."},404);
  try{const {error:saveError}=await createWorkerClient().rpc("reconcile_management_dispatch",{p_key:body.key,p_action:body.action,p_actor:user.email!.toLowerCase(),p_evidence:body.evidence,p_provider_id:typeof body.providerId==="string"?body.providerId:null});if(saveError)return reply({error:"Dispatch transition rejected. Check its current state and evidence."},409);return reply({updated:true});}catch(error){return reply({error:error instanceof Error?error.message:"Service connection unavailable."},503);}
 }
 if(!["financial","reminder","section20"].includes(String(body.source))||typeof body.sourceId!=="string"||body.sourceId.length>100)return reply({error:"Choose a saved source record."},400);
 const {data:unitRows,error:unitError}=await client.from("units").select("id,block_id,unit_number,payment_reference").eq("block_id",block.id);
 const {data:states,error:stateError}=await client.from("management_review_state").select("area,state,revision").eq("block_id",block.id).in("area",["financials","debtors","leaseholders"]);
 if(unitError||stateError)return reply({error:"Source records could not be loaded."},503);
 const units=(unitRows??[]).map(u=>({id:u.id,blockId:u.block_id,unitNumber:u.unit_number,paymentReference:u.payment_reference})),unitIds=units.map(u=>u.id),today=londonDate(),find=(area:string)=>(states??[]).find(s=>s.area===area);
 try{
  const lease=find("leaseholders"),registry=validateLeaseholderState(lease?.state??{contacts:[],consultations:[]},block.id,unitIds,today);
  let envelopes:Readonly<DeliveryEnvelope>[]=[],sourceEvidence:unknown={},earliestDate=today;
  if(body.source==="financial"){
   const saved=find("financials");if(!saved)throw Error("Save a prepared financial batch first.");const state=validateFinancialState(saved.state,block.id,unitIds,today);if(state.prepared?.input.batchId!==body.sourceId)throw Error("The saved financial batch changed. Reload before queuing.");earliestDate=state.prepared.input.issueDate;
   const {data:settings,error:settingsError}=await client.from("service_charge_document_settings").select("settings").eq("block_id",block.id).maybeSingle();if(settingsError)throw Error("Document settings unavailable.");
   const rows=await financialDraftToLedgerRows(state.prepared.input,units,true);const {data:entries,error:ledgerError}=await client.from("service_charge_entries").select("request_id,reference,unit_id,entry_type,description,amount_pence,entry_date,due_date").eq("block_id",block.id).in("request_id",rows.map(r=>r.request_id));if(ledgerError)throw Error("Posted ledger references could not be verified.");
   const docs=await generateFinancialDocuments({state,revision:saved.revision,today,mode:"Issue",block:{id:block.id,name:block.name,address:block.address,managementCompany:block.management_company},units,settings:settings?.settings,ledgerEntries:entries??[],documentReview:body.documentReview as FinancialDocumentInput["documentReview"]});
   for(const doc of docs)envelopes.push(...await prepareDeliveryEnvelopes({operationId:`financial:${body.sourceId}:r${saved.revision}:c${lease?.revision}`,kind:doc.kind,blockId:block.id,unitId:doc.unitId,subject:doc.subject,body:doc.body,attachments:[doc.attachment],contacts:registry.contacts}));
   sourceEvidence={financialRevision:saved.revision,contactRevision:lease?.revision,documentHashes:docs.map(d=>d.contentHash)};
  }else if(body.source==="reminder"){
   const saved=find("debtors"),state=validateDebtorState(saved?.state,block.id,unitIds,today),draft=state.history.find(h=>h.id===body.sourceId);if(!draft)throw Error("Saved reminder is unavailable.");
   const allowed=new Set(contactRecipients(registry.contacts.filter(c=>c.unitId===draft.unitId),block.id,"Demand").map(r=>r.email));if(draft.recipients.some(email=>!allowed.has(email)))throw Error("Reminder recipients must match current confirmed leaseholder contacts for this unit.");
   envelopes=await prepareDeliveryEnvelopes({operationId:`reminder:${draft.id}:r${saved?.revision}:c${lease?.revision}`,kind:draft.stage,blockId:block.id,unitId:draft.unitId,subject:draft.subject,body:draft.body,attachments:[{...draft.attachment,encoding:"utf8"}],contacts:registry.contacts.map(c=>({...c,emails:c.emails.filter(email=>draft.recipients.includes(email))})).filter(c=>c.emails.length>0)});sourceEvidence={reminderRevision:saved?.revision,contactRevision:lease?.revision};
  }else{
   const draft=registry.consultations.find(c=>c.id===body.sourceId);if(!draft)throw Error("Saved consultation is unavailable.");const coverage=assertConsultationDispatchReady(draft,registry.contacts,block.id);
   envelopes=await prepareDeliveryEnvelopes({operationId:`section20:${draft.id}:r${lease?.revision}`,kind:"Section20",blockId:block.id,subject:draft.subject,body:draft.message,attachments:[{fileName:`section20-${draft.id.replace(/[^a-zA-Z0-9-]/g,"")}.txt`,mediaType:"text/plain",encoding:"utf8",content:draft.message}],contacts:registry.contacts.map(c=>({...c,emails:c.emails.filter(email=>draft.recipients.some(r=>r.email===email))})).filter(c=>c.emails.length>0)});sourceEvidence={consultationRevision:lease?.revision,coverage};
  }
  let scheduled=new Date(typeof body.scheduledAt==="string"?body.scheduledAt:Date.now());if(!Number.isFinite(scheduled.valueOf()))throw Error("Choose a valid scheduled issue time.");if(scheduled.toISOString().slice(0,10)<earliestDate)throw Error("Delivery cannot precede the planned issue date.");
  const hashBytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({envelopes,sourceEvidence,scheduledAt:scheduled.toISOString()}))));const previewToken=Array.from(hashBytes,b=>b.toString(16).padStart(2,"0")).join("");
  if(body.preview===true)return reply({envelopes,sourceEvidence,previewToken,scheduledAt:scheduled.toISOString(),emailSent:false});
  if(body.approved!==true||body.previewToken!==previewToken)throw Error("The source or recipients changed. Preview and explicitly approve the exact messages again before queuing.");
  const rows=envelopes.map(e=>({idempotency_key:e.idempotencyKey,block_id:block.id,unit_id:e.unitId,operation_id:e.operationId,kind:e.kind,recipient:e.to,envelope:{...e,sourceEvidence},scheduled_at:scheduled.toISOString()}));
  const {data,error}=await createWorkerClient().rpc("queue_management_dispatches",{p_rows:rows,p_actor:user.email!.toLowerCase()});if(error)return reply({error:error.code==="23505"?"This source already has a different queued snapshot. Review the existing record instead of sending twice.":"Queueing was not confirmed. Reload history before retrying."},409);
  return reply({queued:data,emailSent:false,deliveryEnabled:process.env.LONDON_DELIVERY_ENABLED==="1",sourceEvidence});
 }catch(error){return reply({error:error instanceof Error?error.message:"Dispatch preparation failed."},error instanceof WorkerConfigurationError?503:400);}
}
