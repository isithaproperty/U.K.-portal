import test from 'node:test';import assert from 'node:assert/strict';
import {initialDemandBudget} from '../lib/recipient-budget-pdf.ts';
import {validateRecipientBudgets} from '../lib/recipient-budget.ts';
import {prepareDeliveryEnvelopes} from '../lib/management-delivery.ts';
import {sendResendEnvelope} from '../lib/management-dispatch.ts';
const summary={blockId:1,yearStart:'2026-10-01',scheduleId:'main',categories:[{name:'Insurance',amountPence:15000},{name:'Cleaning',amountPence:5000}],totalPence:20000};
const state={blockId:1,yearStart:'2026-10-01',kind:'Demand',initialDemand:true,schedules:[{id:'main',name:'Main schedule',amount:'200.00'}],recipientBudgets:[summary],prepared:{input:{}}};
const block={id:1,name:'Example Court'};
test('initial demand produces deterministic recipient-safe PDF with exact reviewed categories',()=>{
 const result=initialDemandBudget(state,block,2),again=initialDemandBudget(state,block,2);
 assert.deepEqual(result,again);const text=Buffer.from(result.attachment.content,'base64').toString('latin1');
 assert.ok(text.startsWith('%PDF-1.4'));assert.match(text,/Insurance: £150.00/);assert.match(text,/Cleaning: £50.00/);assert.match(text,/2026-10-01 to 2027-09-30/);assert.match(text,/Annual schedule total: £200.00/);
 assert.notEqual(result.evidence.sha256,initialDemandBudget(state,block,3).evidence.sha256);
});
test('initial issue requires explicit saved choice and complete matching budgets',()=>{
 for(const patch of [{initialDemand:undefined},{recipientBudgets:[]},{recipientBudgets:[{...summary,blockId:2}]},{recipientBudgets:[{...summary,yearStart:'2025-10-01'}]},{recipientBudgets:[{...summary,totalPence:1}]},{schedules:[{...state.schedules[0],amount:'201.00'}]}])assert.throws(()=>initialDemandBudget({...state,...patch},block,2));
 assert.throws(()=>initialDemandBudget(state,{...block,id:2},2));
});
test('later demands, credit notes and reminder kinds do not select a budget',()=>{
 assert.equal(initialDemandBudget({...state,initialDemand:false},block,2),null);
 for(const kind of ['Surplus credit','First reminder','Final reminder'])assert.equal(initialDemandBudget({...state,kind},block,2),null);
});
test('reject malformed labels, duplicate schedules and invalid amounts',()=>{
 for(const value of [[summary,summary],[{...summary,categories:[{name:'A\nB',amountPence:20000}]}],[{...summary,categories:[{name:'A',amountPence:-1}]}]])assert.throws(()=>validateRecipientBudgets(value,1,state.yearStart,state.schedules));
});
test('exact PDF bytes bind private envelope and disabled transport never sends',async()=>{
 const budget=initialDemandBudget(state,block,2),input={operationId:'first-year',kind:'Demand',blockId:1,unitId:10,subject:'Initial demand',body:'Demand',attachments:[{fileName:'demand.txt',mediaType:'text/plain',encoding:'utf8',content:'Individual demand'},budget.attachment],contacts:[{id:'contact',blockId:1,unitId:10,name:'Owner',role:'Leaseholder',emails:['owner@example.invalid'],communications:true,demands:true}]};
 const [envelope]=await prepareDeliveryEnvelopes(input);assert.equal(envelope.attachments.length,2);assert.equal(envelope.attachments[1].content,budget.attachment.content);
 const [changed]=await prepareDeliveryEnvelopes({...input,attachments:[input.attachments[0],initialDemandBudget(state,block,3).attachment]});assert.notEqual(changed.idempotencyKey,envelope.idempotencyKey);
 let calls=0;await assert.rejects(()=>sendResendEnvelope(envelope,{enabled:false},async()=>{calls++;throw Error('must not run');}));assert.equal(calls,0);
});
