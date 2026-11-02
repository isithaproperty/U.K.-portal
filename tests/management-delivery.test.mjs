import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDeliveryEnvelopes,pendingDelivery,transitionDelivery} from '../lib/management-delivery.ts';
const contacts=[{id:'owner',blockId:1,unitId:10,name:'Owner',role:'Leaseholder',emails:['owner@example.test','joint@example.test'],communications:true,demands:true},{id:'tenant',blockId:1,unitId:10,name:'Tenant',role:'Tenant',emails:['tenant@example.test'],communications:true,demands:true},{id:'other',blockId:1,unitId:11,name:'Other',role:'Leaseholder',emails:['other@example.test'],communications:true,demands:true},{id:'association',blockId:1,unitId:null,name:'Association',role:'Recognised association',emails:['association@example.test'],communications:true,demands:false}];
const input={operationId:'operation-1',kind:'Demand',blockId:1,unitId:10,subject:' Exact subject ',body:'Exact message\n\nSecond paragraph.\n',attachments:[{fileName:'demand.txt',mediaType:'text/plain',encoding:'utf8',content:'Exact document\r\n'}],contacts};
const at='2026-11-02T12:00:00Z';
const later='2026-11-02T12:01:00Z';
test('single-recipient envelopes exclude tenants and other unit financial accounts',async()=>{
 const envelopes=await prepareDeliveryEnvelopes(input);
 assert.deepEqual(envelopes.map(e=>e.to),['owner@example.test','joint@example.test']);
 assert.equal(envelopes[0].subject,input.subject);assert.equal(envelopes[0].body,input.body);assert.equal(envelopes[0].attachments[0].content,input.attachments[0].content);
 assert.equal(Object.isFrozen(envelopes[0]),true);assert.equal(Object.isFrozen(envelopes[0].attachments[0]),true);
 assert.equal(envelopes[0].cc,undefined);assert.equal(envelopes[0].bcc,undefined);
 for(const kind of ['First reminder','Final reminder']) assert.deepEqual((await prepareDeliveryEnvelopes({...input,kind})).map(e=>e.to),['owner@example.test','joint@example.test']);
 const consultation=await prepareDeliveryEnvelopes({...input,kind:'Section20',unitId:null});
 assert.deepEqual(consultation.map(e=>e.to),['owner@example.test','joint@example.test','other@example.test','association@example.test']);
});
test('keys are deterministic and bind exact subject, body, attachments and each recipient',async()=>{
 const first=await prepareDeliveryEnvelopes(input),second=await prepareDeliveryEnvelopes(input);
 assert.equal(first[0].idempotencyKey,second[0].idempotencyKey);assert.notEqual(first[0].idempotencyKey,first[1].idempotencyKey);
 for(const patch of [{subject:input.subject+' '},{body:input.body+' '},{operationId:'other'},{attachments:[{...input.attachments[0],content:'changed'}]}]) assert.notEqual(first[0].idempotencyKey,(await prepareDeliveryEnvelopes({...input,...patch}))[0].idempotencyKey);
});
test('malformed scope, recipients, content and attachment representations are rejected',async()=>{
 for(const patch of [{unitId:null},{blockId:2},{subject:'x\r\nBcc: thief@example.test'},{body:''},{attachments:[]},{attachments:[{...input.attachments[0],fileName:'../notice.txt'}]},{attachments:[{...input.attachments[0],mediaType:'application/pdf'}]},{attachments:[{...input.attachments[0],encoding:'base64',content:'invalid!'}]},{contacts:contacts.filter(c=>c.role==='Tenant')}]) await assert.rejects(prepareDeliveryEnvelopes({...input,...patch}));
});
test('acceptance is distinct from delivery and final evidence is bound to provider message',async()=>{
 const envelope=(await prepareDeliveryEnvelopes(input))[0];
 const pending=pendingDelivery(envelope,at),sending=transitionDelivery(pending,{type:'Start',at});
 assert.equal(sending.attemptCount,1);assert.equal(pending.status,'Pending');
 const sent=transitionDelivery(sending,{type:'ProviderAccepted',at:later,providerMessageId:'provider-1',evidence:'HTTP accepted response'});
 assert.equal(sent.status,'Sent');assert.equal(sent.deliveryEvidence,'Provider accepted');assert.equal(sent.deliveredAt,null);
 assert.throws(()=>transitionDelivery(sent,{type:'Start',at:later}));
 assert.throws(()=>transitionDelivery(sent,{type:'Delivered',at:later,providerMessageId:'wrong',evidence:'webhook'}));
 const delivered=transitionDelivery(sent,{type:'Delivered',at:later,providerMessageId:'provider-1',evidence:'verified delivery webhook'});
 assert.equal(delivered.deliveryEvidence,'Delivered');assert.equal(delivered.deliveredAt,later);
 assert.throws(()=>transitionDelivery(delivered,{type:'Bounced',at:later,providerMessageId:'provider-1',evidence:'contradictory event'}));
});
test('uncertain submissions cannot be blindly resent; reconciliation controls release',async()=>{
 const envelope=(await prepareDeliveryEnvelopes(input))[0],sending=transitionDelivery(pendingDelivery(envelope,at),{type:'Start',at});
 const uncertain=transitionDelivery(sending,{type:'OutcomeUnknown',at:later,evidence:'transport timeout after submission'});
 for(const type of ['Start','RetryFailed','ProviderRejected']) assert.throws(()=>transitionDelivery(uncertain,{type,at:later,evidence:'retry',knownNotAccepted:true}));
 assert.throws(()=>transitionDelivery(uncertain,{type:'ReconcileNotAccepted',at:later,evidence:'guess',knownNotAccepted:false}));
 const failed=transitionDelivery(uncertain,{type:'ReconcileNotAccepted',at:later,evidence:'Authoritative provider idempotency lookup: absent',knownNotAccepted:true});
 const retry=transitionDelivery(transitionDelivery(failed,{type:'RetryFailed',at:later}),{type:'Start',at:later});
 assert.equal(retry.attemptCount,2);assert.equal(retry.envelope.idempotencyKey,envelope.idempotencyKey);
 const reconciled=transitionDelivery(uncertain,{type:'ReconcileAccepted',at:later,evidence:'Authoritative provider lookup',providerMessageId:'provider-1'});
 assert.equal(reconciled.status,'Sent');assert.equal(reconciled.deliveryEvidence,'Provider accepted');
 assert.throws(()=>transitionDelivery(sending,{type:'ProviderRejected',at:later,evidence:'timeout',knownNotAccepted:false}));
 assert.throws(()=>transitionDelivery(sending,{type:'OutcomeUnknown',at:'2026-11-02T11:00:00Z',evidence:'out of order'}));
});
