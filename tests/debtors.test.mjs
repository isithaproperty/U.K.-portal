import test from "node:test";
import assert from "node:assert/strict";
import {agedAccount,captureReminder,readDebtorReviewState,validateDebtorState,retainReminder,standingOrderAction} from "../lib/debtors.ts";
const charge=(id,amount,due,date="2026-01-01")=>({id,block_id:1,unit_id:1,entry_type:"Charge",description:"Service charge",amount_pence:amount,entry_date:date,due_date:due,reference:`INV-${id}`});
const receipt=(id,type,amount,date="2026-10-01")=>({...charge(id,amount,null,date),entry_type:type});
test("partial payments and credits settle oldest due charges before ageing",()=>{
 const result=agedAccount([charge(1,10000,"2026-07-01"),charge(2,10000,"2026-09-20"),charge(3,10000,"2026-10-20"),receipt(4,"Payment",11000),receipt(5,"Credit",4000)],"2026-11-02");
 assert.equal(result.days91plus,0);assert.equal(result.days31to60,5000);assert.equal(result.days1to30,10000);assert.equal(result.balance,15000);
 assert.equal(result.lastPayment.reference,"INV-4");
});
test("unposted future demands, payments and credits do not affect age or last payment",()=>{
 const result=agedAccount([charge(1,10000,"2026-12-01"),charge(2,90000,"2026-12-02","2026-12-01"),receipt(3,"Payment",50000,"2026-12-01"),receipt(4,"Credit",10000,"2026-12-01")],"2026-11-02");
 assert.equal(result.balance,10000);assert.equal(result.notDue,10000);assert.equal(result.days1to30,0);assert.equal(result.lastPayment,null);
});
test("bucket boundaries, due today, missing due dates, overpayments and leap dates",()=>{
 const result=agedAccount([charge(1,1,"2026-11-02"),charge(2,1,"2026-10-03"),charge(3,1,"2026-10-02"),charge(4,1,"2026-09-03"),charge(5,1,"2026-09-02"),charge(6,1,"2026-08-04"),charge(7,1,"2026-08-03"),charge(8,1,null)],"2026-11-02");
 assert.deepEqual([result.notDue,result.days1to30,result.days31to60,result.days61to90,result.days91plus],[2,1,2,2,1]);
 assert.equal(agedAccount([charge(1,100,"2026-10-01"),receipt(2,"Payment",200)],"2026-11-02").balance,-100);
 assert.equal(agedAccount([],"2024-02-29").balance,0);
 assert.throws(()=>agedAccount([],"2026-02-29"));
 assert.throws(()=>agedAccount([charge(1,100,"2026-02-30")],"2026-11-02"));
 assert.throws(()=>agedAccount([charge(1,100,null),{...charge(2,100,null),unit_id:2}],"2026-11-02"));
});
test("reminder retries retain one immutable snapshot, addresses deduplicate, empty inputs reject",()=>{
 const attachment={fileName:"account.txt",mediaType:"text/plain",content:"Exact account document"};
 const draft=captureReminder({id:"request-1",unitId:1,stage:"First reminder",preparedAt:"2026-11-02T09:00:00Z",recipients:["Owner@Example.com","owner@example.com"],subject:"First reminder",body:"Please review",accountNote:"Manager only",attachment});
 attachment.content="Changed later";
 assert.equal(draft.attachment.content,"Exact account document");assert.equal(draft.recipients.length,1);assert.equal(draft.deliveryStatus,"Draft — not sent");
 assert.equal(retainReminder(retainReminder([],draft),draft).length,1);
 assert.throws(()=>captureReminder({...draft,recipients:[]}));assert.throws(()=>captureReminder({...draft,subject:" "}));assert.throws(()=>captureReminder({...draft,recipients:["wrong"]}));assert.throws(()=>captureReminder({...draft,attachment:{...draft.attachment,content:""}}));
});
test("standing order expectations never count as receipts",()=>{
 assert.match(standingOrderAction("Payment allocation review",""),/not evidence of payment/);
 assert.match(standingOrderAction("Payment allocation review","BANK-1"),/before posting/);
 assert.match(standingOrderAction("Invoice preparation review",""),/No charge is posted/);
});
test("persisted review state enforces block unit boundaries and exact snapshot fields",()=>{
 const empty=readDebtorReviewState(null,[1]);
 assert.deepEqual(empty,{notes:{},history:[],mode:"Payment allocation review",receipt:""});
 const draft=captureReminder({id:"request-1",unitId:1,stage:"Final reminder",preparedAt:"2026-11-02T09:00:00Z",recipients:["owner@example.com"],subject:"Final reminder",body:"Exact message",accountNote:"Private",attachment:{fileName:"account.txt",mediaType:"text/plain",content:"Exact account document"}});
 const state={notes:{1:"Private"},history:[draft],mode:"Payment allocation review",receipt:"BANK-1"};
 assert.deepEqual(validateDebtorState(state,20,[1],"2026-11-02"),state);
 assert.throws(()=>validateDebtorState(state,20,[2],"2026-11-02"));
 assert.throws(()=>validateDebtorState({...state,notes:{2:"Wrong block"}},20,[1],"2026-11-02"));
 assert.throws(()=>validateDebtorState({...state,history:[draft,{...draft}]},20,[1],"2026-11-02"));
 assert.throws(()=>validateDebtorState({...state,history:[{...draft,deliveryStatus:"Sent"}]},20,[1],"2026-11-02"));
 assert.throws(()=>validateDebtorState({...state,history:[{...draft,subject:{}}]},20,[1],"2026-11-02"));
 assert.throws(()=>validateDebtorState({...state,history:[{...draft,attachment:{...draft.attachment,content:""}}]},20,[1],"2026-11-02"));
 assert.throws(()=>validateDebtorState(null,20,[1],"2026-11-02"));
 assert.throws(()=>validateDebtorState(state,0,[1],"2026-11-02"));
});
