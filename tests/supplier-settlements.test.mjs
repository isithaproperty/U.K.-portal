import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSupplierSettlement,recordedInvoiceSettlement} from '../lib/supplier-settlements.ts';
const today='2026-11-02';
const request={requestId:'00000000-0000-0000-0000-000000000001',revision:1,bankTransactionId:' BANK-42 ',paymentDate:today,amountPence:10000,evidence:'Checked bank statement transaction 42',confirmedActualPayment:true,allocations:[{invoiceId:'invoice-1',amountPence:10000}]};
test('actual settlement normalizes unique transaction ID and preserves scoped allocations',()=>{
 const valid=validateSupplierSettlement(request,today);assert.equal(valid.bankTransactionId,'bank-42');assert.equal(valid.allocations[0].amountPence,10000);
 assert.deepEqual(validateSupplierSettlement({...request,amountPence:10000,allocations:[{invoiceId:'invoice-1',amountPence:4000},{invoiceId:'invoice-2',amountPence:6000}]},today).allocations.length,2);
});
test('settlements require actual evidence, complete allocations and valid dates',()=>{
 for(const patch of [{confirmedActualPayment:false},{evidence:'x'},{paymentDate:'2026-11-03'},{paymentDate:'2026-02-30'},{amountPence:0},{amountPence:100.5},{revision:0},{bankTransactionId:''},{requestId:'new'},{allocations:[]},{allocations:[{invoiceId:'invoice-1',amountPence:9999}]},{allocations:[{invoiceId:'invoice-1',amountPence:5000},{invoiceId:'invoice-1',amountPence:5000}]}])assert.throws(()=>validateSupplierSettlement({...request,...patch},today));
});
test('paid status uses actual settlement allocations only and respects partial payment',()=>{
 assert.equal(recordedInvoiceSettlement('invoice-1',10000,[]).status,'Unpaid');
 const allocations=[{settlement_id:'s1',invoice_id:'invoice-1',amount_pence:4000,work_order_id:1},{settlement_id:'s2',invoice_id:'other-invoice',amount_pence:10000,work_order_id:2}];
 assert.deepEqual(recordedInvoiceSettlement('invoice-1',10000,allocations),{paidPence:4000,outstandingPence:6000,status:'Part paid'});
 assert.equal(recordedInvoiceSettlement('invoice-1',10000,[...allocations,{settlement_id:'s3',invoice_id:'invoice-1',amount_pence:6000,work_order_id:1}]).status,'Paid');
});
