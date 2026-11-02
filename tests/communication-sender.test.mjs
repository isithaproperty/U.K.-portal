import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import * as helpers from "../lib/communication-recipients.ts";
const requestId="11111111-1111-4111-8111-111111111111";
const contacts={contacts:[{id:"c1",blockId:1,role:"Leaseholder",emails:["owner@example.com","joint@example.com"],communications:true},{id:"c2",blockId:1,role:"Tenant",emails:["tenant@example.com"],communications:true}]};
const activeResidents=[{id:1,email:"owner@example.com",block_id:1},{id:2,email:"tenant@example.com",block_id:1}];
function harness({role="owner",manager="Portfolio A",missingContacts=false,failProvider=false,failPublication=false}={}){
 const tables={portal_members:[{email:"manager@example.com",role,portfolio_manager:manager}],blocks:[{id:1,name:"Example block",manager:"Portfolio A"}],residents:structuredClone(activeResidents),management_review_state:[{block_id:1,area:"leaseholders",revision:1,state:structuredClone(contacts)}],communication_delivery_requests:[],communications:[]};
 const calls=[];let publicationFails=failPublication,providerFails=failProvider;
 class Query{
  constructor(table){this.table=table;this.filters=[];this.mode="select";this.values=null;this.one=false;this.offset=0;this.end=999999;}
  select(){return this;}eq(key,value){this.filters.push(row=>row[key]===value);return this;}in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}is(key,value){this.filters.push(row=>(row[key]??null)===value);return this;}order(){return this;}range(offset,end){this.offset=offset;this.end=end;return this;}
  maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}insert(values){this.mode="insert";this.values=values;return this;}update(values){this.mode="update";this.values=values;return this;}
  then(resolve,reject){if(!this.promise)this.promise=Promise.resolve().then(()=>{
   if(missingContacts&&this.table==="management_review_state")return {data:null,error:{code:"42P01"}};
   if(this.mode==="insert"){
    if(this.table==="communications"&&publicationFails){publicationFails=false;return {data:null,error:{code:"database-unavailable"}};}
    const rows=Array.isArray(this.values)?this.values:[this.values];
    for(const input of rows){if(this.table==="communication_delivery_requests"&&tables[this.table].some(row=>row.request_id===input.request_id)||this.table==="communications"&&tables[this.table].some(row=>row.delivery_request_id===input.delivery_request_id))return {data:null,error:{code:"23505"}};}
    const inserted=rows.map(input=>({id:tables[this.table].length+1,created_at:new Date().toISOString(),...(this.table==="communication_delivery_requests"?{status:"processing"}:{}),...structuredClone(input)}));tables[this.table].push(...inserted);return {data:this.one?inserted[0]:inserted,error:null};
   }
   const rows=tables[this.table].filter(row=>this.filters.every(filter=>filter(row))).slice(this.offset,this.end+1);
   if(this.mode==="update")for(const row of rows)Object.assign(row,structuredClone(this.values));
   return {data:this.one?rows[0]??null:rows,error:null};
  });return this.promise.then(resolve,reject);}
 }
 let handler;const fakeProvider=async(url,request)=>{calls.push({url,...request});assert.equal(tables.communication_delivery_requests.length,1,"durable reservation must precede the provider");if(providerFails){providerFails=false;throw new Error("Mock network interruption");}return new Response(JSON.stringify({data:JSON.parse(request.body).map((_,i)=>({id:`mock-provider-${i}`}))}),{status:200});};
 const environment={SUPABASE_URL:"https://example.invalid",SUPABASE_SERVICE_ROLE_KEY:"fake-service-key",RESEND_API_KEY:"fake-provider-key",RESEND_FROM_EMAIL:"example@example.com"};
 const imports={...helpers,deliverCommunicationBatch:(emails,id,index,key)=>helpers.deliverCommunicationBatch(emails,id,index,key,fakeProvider)};
 const source=readFileSync(new URL("../supabase/functions/resident-communication/index.ts",import.meta.url),"utf8").replace(/^import[^\n]*\n/gm,"");
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 new Function("Deno","createClient",...Object.keys(imports),compiled)({serve:fn=>{handler=fn;},env:{get:key=>environment[key]}},()=>({auth:{getUser:async token=>({data:{user:token==="test-token"?{email:"manager@example.com"}:null},error:null})},from:table=>new Query(table)}),...Object.values(imports));
 async function body(audience="saved-contacts"){
  const resolved=helpers.resolveCommunicationRecipients(1,audience,activeResidents,audience==="saved-contacts"?contacts:null);
  return {blockIds:[1],audience,requestId,subject:"Block update",message:"Exact private message",previewFingerprints:{1:await helpers.communicationFingerprint({blockId:1,audience,revision:audience==="saved-contacts"?1:0,...resolved})}};
 }
 async function invoke(payload,token="test-token"){const response=await handler(new Request("https://example.invalid/communication",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)}));return {status:response.status,body:await response.json()};}
 return {tables,calls,body,invoke};
}
test("mocked sender freezes private emails and publishes only real captured assignments",async()=>{
 const h=harness(),payload=await h.body();const result=await h.invoke(payload);assert.equal(result.status,200);assert.equal(result.body.recipientCount,3);assert.equal(h.calls.length,1);
 const outbound=JSON.parse(h.calls[0].body);assert.ok(outbound.every(email=>email.to.length===1&&!email.cc&&!email.bcc));
 assert.equal(h.tables.communications.length,1);assert.deepEqual(h.tables.communications[0].recipient_snapshot.map(r=>r.email),["owner@example.com","tenant@example.com"]);
 assert.equal(h.tables.communication_delivery_requests[0].status,"sent");
 const replay=await h.invoke(payload);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(h.calls.length,1);assert.equal(h.tables.communications.length,1);
});
test("uncertain mocked provider outcome retries the exact frozen body and stable request key",async()=>{
 const h=harness({failProvider:true}),payload=await h.body();assert.equal((await h.invoke(payload)).status,502);assert.equal(h.tables.communication_delivery_requests.length,1);
 h.tables.management_review_state[0].state.contacts[0].emails.push("changed@example.com");
 assert.equal((await h.invoke(payload)).status,200);assert.equal(h.calls.length,2);assert.equal(h.calls[0].headers["Idempotency-Key"],h.calls[1].headers["Idempotency-Key"]);assert.equal(h.calls[0].body,h.calls[1].body);assert.equal(h.tables.communications.length,1);
});
test("publication failure reuses request, while expired uncertain outcomes refuse provider calls",async()=>{
 const h=harness({failPublication:true}),payload=await h.body();assert.equal((await h.invoke(payload)).status,500);assert.equal(h.tables.communications.length,0);assert.equal((await h.invoke(payload)).status,200);assert.equal(h.tables.communications.length,1);assert.equal(h.calls[0].body,h.calls[1].body);
 const expired=harness({failProvider:true}),expiredPayload=await expired.body();await expired.invoke(expiredPayload);expired.tables.communication_delivery_requests[0].created_at="2020-01-01T00:00:00Z";assert.equal((await expired.invoke(expiredPayload)).status,409);assert.equal(expired.calls.length,1);
});
test("stale previews, changed request payloads and unauthorized managers never initiate a send",async()=>{
 const h=harness(),payload=await h.body();h.tables.management_review_state[0].revision=2;const stale=await h.invoke(payload);assert.equal(stale.status,409);assert.equal(stale.body.previewChanged,true);assert.equal(h.calls.length,0);assert.equal(h.tables.communication_delivery_requests.length,0);
 const unauthorized=harness({role:"manager",manager:"Other portfolio"});assert.equal((await unauthorized.invoke(await unauthorized.body())).status,403);assert.equal(unauthorized.calls.length,0);
 const resident=harness({role:"resident"});assert.equal((await resident.invoke(await resident.body())).status,403);assert.equal(resident.calls.length,0);
 const completed=harness(),original=await completed.body();await completed.invoke(original);assert.equal((await completed.invoke({...original,message:"Changed"})).status,409);assert.equal(completed.calls.length,1);
});
test("missing saved-contact storage fails closed while explicit legacy audience remains usable",async()=>{
 const h=harness({missingContacts:true});assert.equal((await h.invoke(await h.body())).status,503);assert.equal(h.calls.length,0);
 const result=await h.invoke(await h.body("legacy-residents"));assert.equal(result.status,200);assert.equal(result.body.recipientCount,2);
 assert.equal((await h.invoke(null)).status,400);assert.equal((await h.invoke({})).status,400);assert.equal((await h.invoke(await h.body(),"invalid-token")).status,401);
});
