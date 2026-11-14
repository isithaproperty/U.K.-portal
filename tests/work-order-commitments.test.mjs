import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBuildingStatement,statementCsv} from '../lib/building-statement.ts';
import {buildBudgetSpend} from '../lib/budget-spend.ts';
const order=(patch={})=>({id:1,blockId:1,contractorId:3,status:'Open',paymentStatus:'Not approved',workOrderNumber:'WO-1',title:'Cleaning',createdAt:'2026-04-01T12:00:00Z',estimatedCost:1200,actualCost:null,...patch});
const invoice=(id,amountPence=10000,invoiceDate='2026-04-02')=>({id,workOrderId:1,contractorId:3,number:id,invoiceDate,dueDate:invoiceDate,amountPence});
const input=(patch={})=>({blockId:1,start:'2026-04-01',end:'2027-03-31',units:[],entries:[],workOrders:[order()],invoices:[],settlements:[],allocations:[],...patch});
const budget=data=>buildBudgetSpend(data,[{id:'clean',name:'Cleaning',budgetPence:200000}],{version:1,blockId:1,yearStart:data.start,assignments:[{workOrderId:1,categoryId:'clean'}]});
test('raised unpaid WO immediately contributes commitment, but no invoice or paid spend',()=>{
 const data=input(),s=buildBuildingStatement(data),b=budget(data);
 assert.equal(s.commitments[0].unbilledPence,120000);assert.equal(s.totals.supplierPaymentsPence,0);assert.equal(s.totals.invoicedPence,0);
 assert.equal(b.total.unbilledPence,120000);assert.equal(b.total.availablePence,80000);assert.equal(b.rows[0].unbilledPence,120000);
 assert.match(statementCsv(s),/Unbilled work-order commitments GBP/);
});
test('invoice replaces commitment once; partial and full payments only affect verified spend',()=>{
 const data=input({workOrders:[order({actualCost:1000})],invoices:[invoice('one',40000)]});
 let b=budget(data);assert.equal(b.total.unbilledPence,60000);assert.equal(b.total.invoicedPence,40000);assert.equal(b.total.availablePence,100000);
 data.settlements=[{id:'s',block_id:1,payment_date:'2026-05-01',amount_pence:20000}];data.allocations=[{settlement_id:'s',invoice_id:'one',work_order_id:1,amount_pence:20000}];
 b=budget(data);assert.equal(b.total.paidPence,20000);assert.equal(b.total.availablePence,100000);assert.equal(b.total.unbilledPence,60000);
 data.invoices.push(invoice('two',60000));b=budget(data);assert.equal(b.total.unbilledPence,0);assert.equal(b.total.invoicedPence,100000);assert.equal(b.total.availablePence,100000);
 data.settlements.push({id:'rest',block_id:1,payment_date:'2026-05-02',amount_pence:80000});data.allocations.push({settlement_id:'rest',invoice_id:'one',work_order_id:1,amount_pence:20000},{settlement_id:'rest',invoice_id:'two',work_order_id:1,amount_pence:60000});
 b=budget(data);assert.equal(b.total.paidPence,100000);assert.equal(b.total.unbilledPence,0);assert.equal(b.total.availablePence,100000);
});
test('ongoing prior-year contract keeps annual cost distinct from successive monthly invoices',()=>{
 const data=input({workOrders:[order({isOngoing:true,createdAt:'2026-03-01',actualCost:1200,paymentStatus:'Approved'})],invoices:[invoice('march',10000,'2026-03-05'),invoice('april'),invoice('may',10000,'2026-05-02')]});
 const b=budget(data);assert.equal(b.total.unbilledPence,90000);assert.equal(b.total.invoicedPence,20000);assert.equal(b.total.paidPence,0);assert.equal(data.workOrders[0].status,'Open');
});
test('scope excludes other blocks, cancelled and future work, while missing costs stay unknown',()=>{
 const data=input({workOrders:[order({estimatedCost:null}),order({id:2,blockId:2}),order({id:3,status:'Cancelled'}),order({id:4,createdAt:'2027-04-01'})]});
 const s=buildBuildingStatement(data);assert.equal(s.commitments.length,1);assert.equal(s.commitments[0].unbilledPence,null);assert.equal(s.totals.missingCommitmentCostCount,1);assert.match(budget(data).warnings.join(' '),/no recorded cost/);
});
test('future invoices do not reduce commitments and over-budget invoices do not create negative commitments',()=>{
 let data=input({invoices:[invoice('future',120000,'2027-04-01')]});assert.equal(budget(data).total.unbilledPence,120000);
 data=input({invoices:[invoice('over',220000)]});const b=budget(data);assert.equal(b.total.unbilledPence,0);assert.equal(b.total.availablePence,-20000);
});

test('completed earlier-year jobs carry their unbilled balance until the final invoice arrives',()=>{
 const data=input({workOrders:[order({status:'Complete',createdAt:'2025-01-01'})],invoices:[invoice('prior',40000,'2026-03-01')]});
 let b=budget(data);assert.equal(b.total.unbilledPence,80000);assert.equal(b.total.invoicedPence,0);assert.equal(b.total.availablePence,120000);
 data.invoices.push(invoice('final',80000));b=budget(data);assert.equal(b.total.unbilledPence,0);assert.equal(b.total.invoicedPence,80000);assert.equal(b.total.availablePence,120000);
});
