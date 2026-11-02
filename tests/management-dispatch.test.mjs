import test from 'node:test';import assert from 'node:assert/strict';
import {sendResendEnvelope,runDispatchJobs,verifyCronAuthorization} from '../lib/management-dispatch.ts';
const envelope={idempotencyKey:'mgmt-v1-example',operationId:'op',kind:'Demand',blockId:1,unitId:10,to:'owner@example.invalid',subject:'Exact subject',body:'Exact body',attachments:[{fileName:'demand.txt',mediaType:'text/plain',encoding:'utf8',content:'Exact document'}]};
test('disabled transport makes no requests; single recipient payload preserves exact bytes and key',async()=>{
 let calls=0;const fake=async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.deepEqual(body.to,['owner@example.invalid']);assert.equal(body.text,'Exact body');assert.equal(Buffer.from(body.attachments[0].content,'base64').toString(),'Exact document');assert.equal(init.headers['Idempotency-Key'],envelope.idempotencyKey);return Response.json({id:'provider-1'});};
 await assert.rejects(()=>sendResendEnvelope(envelope,{enabled:false},fake));assert.equal(calls,0);
 assert.equal((await sendResendEnvelope(envelope,{enabled:true,apiKey:'fake',from:'sender@example.invalid'},fake)).status,'Sent');assert.equal(calls,1);
});
test('timeout and ambiguous provider errors become uncertain; definitive rejects do not imply sending',async()=>{
 for(const code of [500,502,409])assert.equal((await sendResendEnvelope(envelope,{enabled:true,apiKey:'fake',from:'s@example.invalid'},async()=>Response.json({}, {status:code}))).status,'Uncertain');
 assert.equal((await sendResendEnvelope(envelope,{enabled:true,apiKey:'fake',from:'s@example.invalid'},async()=>{throw Error('timeout')})).status,'Uncertain');
 assert.equal((await sendResendEnvelope(envelope,{enabled:true,apiKey:'fake',from:'s@example.invalid'},async()=>Response.json({}, {status:422}))).status,'Failed');
});
test('worker records outcomes only for claimed rows and never retries an uncertain submission',async()=>{
 const completed=[];let claimCount=0;
 const store={claim:async()=>claimCount++?[]:[{idempotency_key:'key',envelope,claim_token:'claim'}],finish:async(row,result)=>completed.push(result)};
 assert.equal((await runDispatchJobs(store,async()=>{throw Error('unknown')},'2026-11-02T12:00:00Z')).length,1);
 assert.equal(completed[0].status,'Uncertain');assert.deepEqual(await runDispatchJobs(store,async()=>{throw Error('must not run')},'2026-11-02T12:00:01Z'),[]);
});
test('cron requires explicit nonempty secret and exact authorization',()=>{
 assert.equal(verifyCronAuthorization(null,undefined),false);assert.equal(verifyCronAuthorization('Bearer short','short'),false);assert.equal(verifyCronAuthorization('Bearer '+ 'x'.repeat(32),'x'.repeat(32)),true);
});
