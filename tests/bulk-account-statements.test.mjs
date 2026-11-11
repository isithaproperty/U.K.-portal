import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBulkAccountStatements} from '../lib/bulk-account-statements.ts';
const block={id:1,name:'Example Court',address:'Example Road'};
const unit=(id=1)=>({id,blockId:1,unitNumber:`Flat ${id}`,paymentReference:`CODE-${id}`});
const row=(id,type,amount,date,due=null,unitId=1)=>({id,block_id:1,unit_id:unitId,entry_type:type,amount_pence:amount,entry_date:date,due_date:due,description:'Recorded item',reference:`REF-${id}`});
export const input={block,units:[unit(),unit(2),unit(3)],entries:[row(1,'Charge',10000,'2026-09-01','2026-09-15'),row(2,'Payment',2500,'2026-10-02'),row(3,'Charge',5000,'2026-10-03','2026-12-01'),row(4,'Credit',2000,'2026-10-04',null,3)],start:'2026-10-01',end:'2026-11-11',today:'2026-11-11',scope:'debt',generatedAt:'2026-11-11T12:00:00Z'};
test('bulk debt statements include opening, partial settlement, movements, due/overdue, and only positive balances',()=>{
 const doc=buildBulkAccountStatements(input);assert.deepEqual(doc.accounts,[{unitId:1,unitNumber:'Flat 1',opening:10000,balance:12500,due:7500,overdue:7500}]);assert.match(doc.html,/Opening balance/);assert.match(doc.html,/£125.00/);assert.match(doc.html,/CODE-1/);assert.match(doc.html,/not a payment demand/i);assert.doesNotMatch(doc.html,/28 days|CODE-2|CODE-3/);
});
test('all scope includes empty and credit accounts without payment requests and separates print pages',()=>{
 const doc=buildBulkAccountStatements({...input,scope:'all'});assert.equal(doc.accounts.length,3);assert.equal(doc.accounts[1].balance,0);assert.equal(doc.accounts[2].balance,-2000);assert.match(doc.html,/Your account balance is zero/);assert.match(doc.html,/Your account is in credit/);assert.match(doc.html,/No movements in this period/);assert.match(doc.html,/break-before:page/);assert.equal((doc.html.match(/MANAGER-ONLY COMBINED FILE/g)||[]).length,3);
});
test('future entries excluded; due today included only in due; missing dates do not invent deadlines',()=>{
 const entries=[row(1,'Charge',1000,'2026-11-01','2026-11-11'),row(2,'Charge',2000,'2026-11-01'),row(3,'Charge',3000,'2026-11-01','2026-12-01'),row(4,'Payment',9999,'2026-12-01')];const doc=buildBulkAccountStatements({...input,entries});assert.equal(doc.accounts[0].balance,6000);assert.equal(doc.accounts[0].due,1000);assert.equal(doc.accounts[0].overdue,0);assert.match(doc.html,/Recorded due date: Not recorded/);assert.doesNotMatch(doc.html,/REF-4/);
});
test('empty and paid buildings return no downloadable debt statements',()=>{
 assert.equal(buildBulkAccountStatements({...input,units:[],entries:[]}).accounts.length,0);
 assert.equal(buildBulkAccountStatements({...input,entries:[row(1,'Charge',100,'2026-09-01'),row(2,'Payment',100,'2026-10-01')]}).accounts.length,0);
});
test('wrong building, unknown units, duplicate rows/units and invalid ledger fail closed',()=>{
 for(const patch of [{units:[{...unit(),blockId:2}]},{units:[unit(),unit()]},{entries:[{...input.entries[0],block_id:2}]},{entries:[{...input.entries[0],unit_id:99}]},{entries:[input.entries[0],input.entries[0]]},{entries:[{...input.entries[0],amount_pence:1.1}]},{entries:[{...input.entries[0],entry_type:'Unknown'}]},{entries:[{...input.entries[0],due_date:'2026-02-30'}]},{entries:undefined},{units:undefined}])assert.throws(()=>buildBulkAccountStatements({...input,...patch}));
});
test('invalid, reversed, future dates, timestamp and unsafe sums fail closed',()=>{
 for(const patch of [{start:'2026-02-30'},{start:'2026-12-01'},{end:'2026-11-12'},{generatedAt:''},{entries:[row(1,'Charge',Number.MAX_SAFE_INTEGER,'2026-10-01'),row(2,'Charge',1,'2026-10-02')]}])assert.throws(()=>buildBulkAccountStatements({...input,...patch}));
});
test('all content is escaped; unrelated internal and resident fields never enter output; inputs unmodified',()=>{
 const dirty={...input,block:{...block,name:'<script>alert(1)</script>',notes:'SECRET-NOTE'},units:[{...unit(),unitNumber:'<img src=x>',paymentReference:'"<&',residentName:'SECRET-OWNER'}],entries:[{...input.entries[0],entry_date:'2026-10-01',description:'<svg onload=alert(2)>',reference:'<iframe>',internalNote:'SECRET-NOTE'}]};const before=JSON.stringify(dirty),doc=buildBulkAccountStatements(dirty);assert.equal(JSON.stringify(dirty),before);assert.doesNotMatch(doc.html,/<script>|<img|<svg|<iframe>|SECRET/);assert.match(doc.html,/&lt;script&gt;/);assert.match(doc.html,/&lt;svg/);
});
