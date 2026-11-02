import test from "node:test";
import assert from "node:assert/strict";
import {resolveCommunicationRecipients,combineCommunicationRecipients,communicationFingerprint,deliverCommunicationBatch,canReplayCommunication,validCommunicationRequestId} from "../lib/communication-recipients.ts";
const residents=[{id:1,block_id:1,email:"owner@example.com"},{id:2,block_id:1,email:"tenant@example.com"},{id:3,block_id:1,email:"archived@example.com",archived_at:"2026-10-01"},{id:4,block_id:2,email:"elsewhere@example.com"}];
const state={contacts:[{id:"1",blockId:1,role:"Leaseholder",emails:["OWNER@example.com","joint@example.com"],communications:true},{id:"2",blockId:1,role:"Tenant",emails:["tenant@example.com"],communications:true},{id:"3",blockId:1,role:"Leaseholder",emails:["optout@example.com"],communications:false}]};
test("saved communication contacts include opted-in owners and tenants with private normalized emails",()=>{
 const resolved=resolveCommunicationRecipients(1,"saved-contacts",residents,state);
 assert.deepEqual(resolved.recipients.map(r=>r.email),["joint@example.com","owner@example.com","tenant@example.com"]);
 assert.deepEqual(resolved.residentSnapshot,[{resident_id:1,block_id:1,email:"owner@example.com"},{resident_id:2,block_id:1,email:"tenant@example.com"}]);
 assert.equal(resolved.residentSnapshot.some(r=>r.email==="joint@example.com"),false,"additional emails never create resident access");
});
test("legacy mode remains explicit and independent from saved contact storage",()=>{
 assert.deepEqual(resolveCommunicationRecipients(1,"legacy-residents",residents,undefined).recipients.map(r=>r.email),["owner@example.com","tenant@example.com"]);
 assert.deepEqual(resolveCommunicationRecipients(1,"saved-contacts",residents,null).recipients,[]);
 assert.throws(()=>resolveCommunicationRecipients(1,"saved-contacts",residents,undefined));
 assert.throws(()=>resolveCommunicationRecipients(1,"saved-contacts",residents,{contacts:[{...state.contacts[0],blockId:2}]}));
 assert.throws(()=>resolveCommunicationRecipients(1,"saved-contacts",residents,{contacts:[{...state.contacts[0],role:"Unclassified"}]}));
 assert.throws(()=>resolveCommunicationRecipients(1,"invalid",residents,state));
});
test("shared addresses are deduplicated across blocks without fabricating portal snapshots",()=>{
 const a=resolveCommunicationRecipients(1,"saved-contacts",residents,state),b=resolveCommunicationRecipients(2,"legacy-residents",[{id:5,block_id:2,email:"owner@example.com"}],null);
 const combined=combineCommunicationRecipients([a,b]);assert.equal(combined.recipients.length,3);assert.deepEqual(combined.recipients.find(r=>r.email==="owner@example.com").blockIds,[1,2]);assert.equal(combined.residentSnapshot.length,3);
});
test("server fingerprints change with contact revision and exact recipient snapshot",async()=>{
 const group=resolveCommunicationRecipients(1,"saved-contacts",residents,state),before=await communicationFingerprint({revision:1,...group});
 assert.equal(await communicationFingerprint({revision:1,...group}),before);
 assert.notEqual(await communicationFingerprint({revision:2,...group}),before);
 assert.notEqual(await communicationFingerprint({revision:1,...group,recipients:[]}),before);
});
const requestId="11111111-1111-4111-8111-111111111111";
const emails=[{from:"test@example.com",to:["owner@example.com"],subject:"Block information",html:"<p>Private</p>",tags:[{name:"category",value:"resident_communication"}]}];
test("mocked provider sees stable retry key, exact body and exactly one address per email",async()=>{
 const calls=[];const provider=async(url,request)=>{calls.push({url,...request});return new Response(JSON.stringify({data:[{id:"provider-id"}]}),{status:200});};
 assert.deepEqual(await deliverCommunicationBatch(emails,requestId,0,"fake-test-key",provider),["provider-id"]);
 await deliverCommunicationBatch(emails,requestId,0,"fake-test-key",provider);
 assert.equal(calls[0].headers["Idempotency-Key"],calls[1].headers["Idempotency-Key"]);assert.equal(calls[0].body,calls[1].body);assert.equal(JSON.parse(calls[0].body)[0].to.length,1);
 await assert.rejects(()=>deliverCommunicationBatch([{...emails[0],to:["a@example.com","b@example.com"]}],requestId,0,"fake",provider));assert.equal(calls.length,2);
});
test("mocked provider failures and incomplete acknowledgements remain unresolved",async()=>{
 await assert.rejects(()=>deliverCommunicationBatch(emails,requestId,0,"fake",async()=>new Response("{}",{status:500})));
 await assert.rejects(()=>deliverCommunicationBatch(emails,requestId,0,"fake",async()=>new Response(JSON.stringify({data:[]}),{status:200})));
 await assert.rejects(()=>deliverCommunicationBatch(emails,"fresh-each-time",0,"fake",async()=>{throw new Error("must not call");}));
});
test("ambiguous sends cannot replay after provider idempotency expiration",()=>{
 const now=Date.parse("2026-11-02T12:00:00Z");assert.equal(canReplayCommunication("2026-11-02T11:00:00Z",now),true);assert.equal(canReplayCommunication("2026-11-01T12:00:00Z",now),false);assert.equal(canReplayCommunication("bad-date",now),false);assert.equal(canReplayCommunication("2026-11-03T12:00:00Z",now),false);assert.equal(validCommunicationRequestId(requestId),true);assert.equal(validCommunicationRequestId("bad"),false);
});
