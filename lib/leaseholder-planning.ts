export type ContactRole = "Leaseholder" | "Tenant" | "Recognised association";
export type ContactDraft = {
 id:string; blockId:number; unitId:number|null; name:string; role:ContactRole;
 emails:string[]; communications:boolean; demands:boolean;
};
export type RecipientPurpose = "Block communication" | "Demand" | "Section 20";
export type RecipientSnapshot = {email:string;contactId:string;name:string;unitId:number|null};
export function parseContactEmails(value:string):string[]{
 const emails=[...new Set(value.split(/[;,\n]+/).map(v=>v.trim().toLowerCase()).filter(Boolean))];
 if(!emails.length||emails.length>10||emails.some(v=>v.length>254||! /^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(v)))throw new Error("Enter 1–10 valid email addresses, separated by commas or new lines.");
 return emails;
}
export function contactRecipients(contacts:ContactDraft[],blockId:number,purpose:RecipientPurpose):RecipientSnapshot[]{
 if(!["Block communication","Demand","Section 20"].includes(purpose))throw new Error("Select a valid recipient purpose.");
 const seen=new Set<string>();const result:RecipientSnapshot[]=[];
 for(const c of contacts){
  if(c.blockId!==blockId)continue;
  if(!["Leaseholder","Tenant","Recognised association"].includes(c.role))continue;
  // A tenant's communication preference can never grant demand or consultation access.
  if(purpose==="Demand"&&(c.role!=="Leaseholder"||!c.demands))continue;
  if(purpose==="Section 20"&&c.role!=="Leaseholder"&&c.role!=="Recognised association")continue;
  if(purpose==="Block communication"&&!c.communications)continue;
  for(const email of parseContactEmails(c.emails.join(","))){if(!seen.has(email)){seen.add(email);result.push({email,contactId:c.id,name:c.name,unitId:c.unitId});}}
 }
 return result;
}
export type ConsultationDraft={
 id:string;blockId:number;title:string;route:string;applicability:string;
 stage:"Notice of intention"|"Statement of estimates / proposals";
 noticeDate:string;serviceDate:string;serviceMethod:string;basisDate:string;basisReason:string;
 confirmed:boolean;subject:string;message:string;recipients:RecipientSnapshot[];
};
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;}
export function consultationReview(draft:ConsultationDraft,today:string){
 if(!validDate(today))throw new Error("A valid review date is required.");
 if(!draft.title.trim()||!draft.route.trim()||!draft.applicability.trim())throw new Error("Record the project, applicable route and applicability review.");
 if(!draft.subject.trim()||!draft.message.trim()||!draft.recipients.length)throw new Error("Add notice text and review the recipient list.");
 if(!draft.confirmed){
  if([draft.noticeDate,draft.serviceDate,draft.basisDate].some(value=>value&&!validDate(value)))throw new Error("Check the optional draft notice dates.");
  return {reviewDate:null,alert:false,status:"Notice draft — service not confirmed",stage:draft.stage};
 }
 if(!draft.confirmed||!draft.serviceMethod.trim()||!draft.basisReason.trim())throw new Error("A manager must confirm the service method and timing basis.");
 if(![draft.noticeDate,draft.serviceDate,draft.basisDate].every(validDate))throw new Error("Notice, service and reviewed timing-basis dates are required.");
 if(draft.serviceDate>today||draft.noticeDate>today||draft.basisDate<draft.noticeDate||draft.basisDate<draft.serviceDate)throw new Error("Check the actual notice/service dates and the reviewed timing basis; future service cannot be confirmed.");
 const date=new Date(`${draft.basisDate}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+30);
 const reviewDate=date.toISOString().slice(0,10);
 return {reviewDate,alert:today>=reviewDate,status:today>=reviewDate?"Manager review due":"Awaiting internal review date",stage:draft.stage};
}

export type LeaseholderState={contacts:ContactDraft[];consultations:ConsultationDraft[]};
/** Validates manager-owned records before storing a block's complete review state. */
export function validateLeaseholderState(value:unknown,blockId:number,unitIds:readonly number[],today:string):LeaseholderState{
 const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("Invalid leaseholder record.");return v as Record<string,unknown>;};
 const text=(v:unknown,max:number)=>{if(typeof v!=="string"||!v.trim()||v.length>max)throw new Error("Leaseholder text is missing or too long.");return v;};
 const optionalText=(v:unknown,max:number)=>{if(typeof v!=="string"||v.length>max)throw new Error("Invalid optional consultation text.");return v;};
 const flag=(v:unknown)=>{if(typeof v!=="boolean")throw new Error("Invalid contact preference or confirmation.");return v;};
 const records=(v:unknown,max:number)=>{if(!Array.isArray(v)||v.length>max)throw new Error("Too many or invalid leaseholder records.");return v;};
 const allowedUnits=new Set(unitIds),state=object(value),ids=new Set<string>();
 const unit=(v:unknown,association=false):number|null=>{if(association&&v===null)return null;if(typeof v!=="number"||!Number.isSafeInteger(v)||!allowedUnits.has(v))throw new Error("Contact or consultation recipient unit is outside this block.");return v;};
 const contacts=records(state.contacts,1000).map(raw=>{
  const c=object(raw),id=text(c.id,100),role=c.role as ContactRole;
  if(c.blockId!==blockId||ids.has(id)||!["Leaseholder","Tenant","Recognised association"].includes(role))throw new Error("Invalid contact block, identity or role.");ids.add(id);
  const emails=records(c.emails,10).map(v=>text(v,254)),parsed=parseContactEmails(emails.join(","));
  if(parsed.length!==emails.length||parsed.some((v,i)=>v!==emails[i]))throw new Error("Contact emails must be normalised and unique.");
  const demands=flag(c.demands);if(role!=="Leaseholder"&&demands)throw new Error("Only confirmed leaseholders may receive financial demands.");
  return {id,blockId,unitId:unit(c.unitId,role==="Recognised association"),name:text(c.name,200),role,emails:parsed,communications:flag(c.communications),demands};
 });
 const contactById=new Map(contacts.map(c=>[c.id,c]));ids.clear();
 const consultations=records(state.consultations,500).map(raw=>{
  const c=object(raw),id=text(c.id,100),stage=c.stage as ConsultationDraft["stage"];
  if(c.blockId!==blockId||ids.has(id)||!["Notice of intention","Statement of estimates / proposals"].includes(stage))throw new Error("Invalid consultation block, identity or stage.");ids.add(id);
  const recipientEmails=new Set<string>();
  const recipients=records(c.recipients,10000).map(rawRecipient=>{
   const r=object(rawRecipient),contactId=text(r.contactId,100),contact=contactById.get(contactId),email=text(r.email,254),unitId=unit(r.unitId,true);
   if(!contact||!["Leaseholder","Recognised association"].includes(contact.role)||contact.unitId!==unitId||!contact.emails.includes(email)||recipientEmails.has(email))throw new Error("Section 20 recipients must be unique confirmed leaseholder or association contacts in this block.");
   recipientEmails.add(email);return {contactId,email,unitId,name:text(r.name,200)};
  });
  const draft:ConsultationDraft={id,blockId,stage,title:text(c.title,300),route:text(c.route,300),applicability:text(c.applicability,10000),noticeDate:optionalText(c.noticeDate,10),serviceDate:optionalText(c.serviceDate,10),serviceMethod:optionalText(c.serviceMethod,500),basisDate:optionalText(c.basisDate,10),basisReason:optionalText(c.basisReason,10000),confirmed:flag(c.confirmed),subject:text(c.subject,300),message:text(c.message,30000),recipients};
  consultationReview(draft,today);return draft;
 });
 return {contacts,consultations};
}
