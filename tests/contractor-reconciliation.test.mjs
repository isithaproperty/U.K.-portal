import test from 'node:test';import assert from 'node:assert/strict';
import {suggestContractor,referenceContains} from '../lib/contractor-reconciliation.ts';
const row={id:1,block_id:1,amount_pence:-10000,transaction_date:'2026-01-05',bank_reference:'payment WO-101',description:'',transaction_id:'bank-1'};
const order={id:101,block_id:1,work_order_number:'WO-101',contractor_id:9,status:'Complete',payment_status:'Approved',actual_cost:100};
const invoice={id:'i1',workOrderId:101,contractorId:9,amountPence:10000,number:'INV-1'};
const match=(r=row,o=[order],i=[invoice],a=[],b=[])=>suggestContractor(r,o,i,a,b,'2026-11-11');
test('exact block and WO suggest full or partial actual settlement',()=>{assert.equal(match().invoiceId,'i1');assert.match(match({...row,amount_pence:-4000}).reason,/Partial/);assert.equal(match({...row,block_id:2}).invoiceId,null);assert.equal(referenceContains('WO-1011','WO-101'),false);assert.equal(referenceContains('WO-101-A','WO-101'),false);});
test('incomplete, unapproved, future, missing ID, duplicate, overpayment and invoice gaps fail closed',()=>{
 for(const r of [{amount_pence:10000},{amount_pence:-10001},{transaction_date:'2027-01-01'},{transaction_id:''},{bank_reference:'WO-1011'}])assert.equal(match({...row,...r}).invoiceId,null);
 for(const o of [{status:'Open'},{payment_status:'Paid'},{payment_status:'Pending'},{actual_cost:200},{contractor_id:10}])assert.equal(match(row,[{...order,...o}]).invoiceId,null);
 assert.equal(match(row,[order],[invoice],[],['bank-1']).invoiceId,null);
 assert.equal(match(row,[order],[invoice],[{invoice_id:'i1',amount_pence:10000}]).invoiceId,null);
 assert.equal(match(row,[order],[]).invoiceId,null);
});
test('ambiguous WO or multiple outstanding invoices require explicit manual allocation',()=>{
 assert.equal(match({...row,bank_reference:'WO-101 WO-102'},[order,{...order,id:102,work_order_number:'WO-102'}]).invoiceId,null);
 assert.equal(match(row,[order],[{...invoice,amountPence:5000},{...invoice,id:'i2',amountPence:5000}]).invoiceId,null);
 assert.equal(match(row,[order],[invoice,invoice]).invoiceId,null);
});
