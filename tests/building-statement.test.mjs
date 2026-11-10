import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBuildingStatement,statementCsv} from '../lib/building-statement.ts';
const unit=(id,blockId=1)=>({id,blockId,unitNumber:`Flat ${id}`,paymentReference:null});
const wo=(id,date='2026-04-02',blockId=1)=>({id,blockId,workOrderNumber:`WO-${id}`,unitId:null,residentId:null,contractorId:3,title:'Repairs',description:'',category:'Repairs',priority:'Normal',status:'Complete',contractor:'Example Ltd',estimatedCost:100,actualCost:80,notes:'',paymentStatus:'Paid',createdAt:date+'T12:00:00Z',updatedAt:date+'T12:00:00Z',createdBy:'',addressSnapshot:'',paymentApprovedBy:null,paymentApprovedAt:null,paidAt:date});
const inv=(id,workOrderId,invoiceDate,amountPence=10000)=>({id,workOrderId,contractorId:3,number:`INV-${id}`,invoiceDate,dueDate:invoiceDate,amountPence});
const settlement=(id,payment_date,amount_pence,block_id=1)=>({id,block_id,payment_date,amount_pence,bank_transaction_id:`BANK-${id}`,evidence:'verified',recorded_by:'owner',recorded_at:payment_date});
const alloc=(settlement_id,invoice_id,amount_pence,work_order_id)=>({settlement_id,invoice_id,amount_pence,work_order_id});
const entry=(id,unit_id,entry_type,amount_pence,entry_date,block_id=1)=>({id,unit_id,block_id,entry_type,amount_pence,entry_date,due_date:entry_type==='Charge'?entry_date:null,description:'',reference:`REF-${id}`});
const input=()=>({blockId:1,start:'2026-04-01',end:'2027-03-31',units:[unit(1),unit(2),unit(9,2)],workOrders:[wo(1),wo(2,'2026-03-01'),wo(3,'2026-04-01',2)],entries:[],invoices:[inv('old',2,'2026-03-02'),inv('new',1,'2026-04-03')],settlements:[settlement('before','2026-03-20',2000),settlement('during','2026-04-20',3000)],allocations:[alloc('before','old',2000,2),alloc('during','old',3000,2)]});
test('separates WO raised costs, invoicing, verified cash payments, opening and closing supplier debt',()=>{
 const result=buildBuildingStatement(input());
 assert.equal(result.workOrders.length,1);assert.equal(result.totals.estimatedPence,10000);assert.equal(result.totals.actualPence,8000);
 assert.equal(result.totals.invoicedPence,10000);assert.equal(result.totals.supplierPaymentsPence,3000);
 assert.equal(result.totals.openingSupplierDebtPence,8000);assert.equal(result.totals.closingSupplierDebtPence,15000);
 assert.equal(result.invoices.find(row=>row.id==='old').inPeriod,false);assert.deepEqual(result.warnings,[]);
});
test('balances include brought-forward arrears without netting one unit credit against another debt',()=>{
 const data=input();data.entries=[entry(1,1,'Charge',10000,'2026-03-01'),entry(2,1,'Payment',2000,'2026-03-10'),entry(3,1,'Charge',5000,'2026-04-01'),entry(4,1,'Payment',3000,'2026-05-01'),entry(5,1,'Credit',1000,'2026-06-01'),entry(6,2,'Payment',4000,'2026-05-01'),entry(7,1,'Payment',9000,'2027-04-01'),entry(8,9,'Charge',100000,'2026-04-01',2)];
 const result=buildBuildingStatement(data);assert.equal(result.residentAccounts.length,2);
 assert.deepEqual(result.residentAccounts[0],{unitId:1,unitNumber:'Flat 1',openingPence:8000,chargesPence:5000,paymentsPence:3000,creditsPence:1000,closingPence:9000,outstandingPence:9000,creditBalancePence:0,overduePence:9000});
 assert.equal(result.totals.residentClosingPence,5000);assert.equal(result.totals.residentOutstandingPence,9000);assert.equal(result.totals.residentCreditBalancesPence,4000);
});
test('unallocated, malformed or cross-building settlements never mark invoices paid',()=>{
 const data=input();data.settlements=[settlement('missing','2026-05-01',1000),settlement('wrong','2026-05-01',1000),settlement('cross','2026-05-01',1000,2),settlement('future','2027-04-01',1000)];data.allocations=[alloc('wrong','new',1000,2),alloc('cross','new',1000,1),alloc('future','new',1000,1)];
 const result=buildBuildingStatement(data);assert.equal(result.totals.supplierPaymentsPence,0);assert.equal(result.totals.closingSupplierDebtPence,20000);assert.equal(result.warnings.length,2);
});
test('rejects unreliable dates, duplicates and overallocated invoices; missing WO costs remain unknown',()=>{
 assert.throws(()=>buildBuildingStatement({...input(),start:'2026-02-30'}));assert.throws(()=>buildBuildingStatement({...input(),end:'2025-01-01'}));
 const data=input();data.units.push(unit(1));assert.throws(()=>buildBuildingStatement(data));
 const over=input();over.settlements=[settlement('over','2026-05-01',11000)];over.allocations=[alloc('over','new',11000,1)];assert.throws(()=>buildBuildingStatement(over));
 const unknown=input();unknown.workOrders[0].estimatedCost=null;unknown.workOrders[0].actualCost=null;const result=buildBuildingStatement(unknown);assert.equal(result.workOrders[0].actualPence,null);assert.equal(result.totals.missingActualCount,1);
});
test('CSV includes detail sections and neutralizes formula-injection text',()=>{
 const data=input();data.workOrders[0].title=' =HYPERLINK("bad")';data.units[0].unitNumber='@SUM(1,2)';const csv=statementCsv(buildBuildingStatement(data));
 assert.match(csv,/Supplier invoices through statement end/);assert.match(csv,/Resident unit accounts/);assert.match(csv,/' =HYPERLINK/);assert.match(csv,/'@SUM/);assert.match(csv,/Actual recorded cost GBP/);
});
