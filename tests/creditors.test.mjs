import test from 'node:test';
import assert from 'node:assert/strict';
import {addSupplierInvoice, addSupplierPayment, duplicateWorkOrders, poundsToPence, supplierInvoiceBalance} from '../lib/creditors.ts';
const today = '2026-11-02';
const order = {id:1, blockId:1, unitId:null, contractorId:9, title:' Roof   repair! ', contractor:'Builder'};
const invoice = {id:'invoice-1',workOrderId:1,contractorId:9,number:'INV-42',amountPence:10000,invoiceDate:'2026-10-01',dueDate:today};
const payment = {id:'payment-1',invoiceId:invoice.id,amountPence:4000,paymentDate:today,bankReference:'BANK-42'};
test('duplicate checks isolate block, unit and supplier; normalize punctuation and spacing', () => {
  const rows = [order,{...order,id:2,title:'roof repair'},{...order,id:3,blockId:2},{...order,id:4,unitId:4},{...order,id:5,contractorId:10}];
  assert.deepEqual(duplicateWorkOrders(rows).map(group => group.map(item => item.id)), [[1,2]]);
  assert.equal(duplicateWorkOrders([{...order,title:''},{...order,id:2,title:''}]).length,0);
});
test('supplier invoice links and retry behavior are validated', () => {
  const rows = addSupplierInvoice([],invoice,[order]);
  assert.equal(addSupplierInvoice(rows,invoice,[order]),rows);
  assert.throws(() => addSupplierInvoice(rows,{...invoice,id:'new',number:'inv 42'},[order]),/already/);
  assert.throws(() => addSupplierInvoice([],{...invoice,contractorId:10},[order]),/assigned/);
  assert.throws(() => addSupplierInvoice([],{...invoice,invoiceDate:'2026-02-30'},[order]),/valid/);
  assert.throws(() => addSupplierInvoice(rows,{...invoice,amountPence:200},[order]),/different/);
});
test('only actual allocations determine paid state, including partial payments', () => {
  assert.equal(supplierInvoiceBalance(invoice,[],today).status,'Unpaid');
  const rows = addSupplierPayment([],payment,[invoice],today);
  assert.equal(supplierInvoiceBalance(invoice,rows,today).status,'Part paid');
  assert.equal(addSupplierPayment(rows,payment,[invoice],today),rows);
  const full = addSupplierPayment(rows,{...payment,id:'payment-2',amountPence:6000,bankReference:'BANK-43'},[invoice],today);
  assert.equal(supplierInvoiceBalance(invoice,full,today).status,'Paid');
  assert.equal(supplierInvoiceBalance(invoice,[{...payment,paymentDate:'2026-11-03'}],today).paidPence,0);
  assert.throws(() => addSupplierPayment(rows,{...payment,id:'again'},[invoice],today),/already/);
  assert.throws(() => addSupplierPayment(rows,{...payment,id:'too-much',amountPence:10000,bankReference:'BANK-44'},[invoice],today),/exceeds/);
  assert.throws(() => addSupplierPayment([],{...payment,paymentDate:'2026-11-03'},[invoice],today),/actual/);
  assert.throws(() => addSupplierPayment([],{...payment,bankReference:''},[invoice],today),/reference/);
  assert.throws(() => addSupplierPayment([],{...payment,invoiceId:'unknown'},[invoice],today),/invoice/);
});
test('currency conversion is exact and rejects missing, negative and fractional pence', () => {
  assert.equal(poundsToPence('12.34'),1234);
  assert.equal(poundsToPence('0.01'),1);
  for(const input of ['', '0', '-1', '0.001', 'NaN', '1e3']) assert.throws(() => poundsToPence(input));
});

test('persisted creditor payload rejects cross-block invoices, forged paid totals and duplicate IDs', async () => {
  const {validateCreditorState} = await import('../lib/creditors.ts');
  assert.deepEqual(validateCreditorState({invoices:[invoice],payments:[payment]},[order],1,today),{invoices:[invoice],payments:[payment]});
  assert.throws(() => validateCreditorState({invoices:[invoice],payments:[]},[order],2,today),/assigned/);
  assert.throws(() => validateCreditorState({invoices:[invoice],payments:[{...payment,amountPence:10001}]},[order],1,today),/exceeds/);
  assert.throws(() => validateCreditorState({invoices:[invoice,invoice],payments:[]},[order],1,today),/Duplicate/);
  assert.throws(() => validateCreditorState({invoices:[invoice],payments:[payment,payment]},[order],1,today),/Duplicate/);
  assert.throws(() => validateCreditorState({invoices:[{...invoice,number:3}],payments:[]},[order],1,today),/text/);
});
