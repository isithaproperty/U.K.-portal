import test from 'node:test';
import assert from 'node:assert/strict';
import {blankClientInvoice,validateClientInvoiceDocument,validateClientInvoiceRequest,clientInvoiceTotals,clientInvoiceDecimal} from '../lib/client-invoices.ts';
import {buildClientInvoicePdf} from '../lib/client-invoice-pdf.ts';
import {invoiceDocument,invoiceRecord,uuid} from './fixtures/client-invoices.mjs';
test('draft defaults do not assume issuer, client, VAT or financial posting',()=>{
 const doc=blankClientInvoice('2026-01-01');assert.equal(doc.issuer.vatRegistered,false);assert.equal(doc.issuer.vatNumber,'');assert.deepEqual(doc.lines,[]);assert.equal(validateClientInvoiceDocument(doc).issuer.name,'');assert.throws(()=>validateClientInvoiceDocument(doc,true));
});
test('explicit VAT registration, reviewed rates, dates and positive ready lines are required',()=>{
 const doc=invoiceDocument();assert.equal(validateClientInvoiceDocument(doc,true).issuer.vatRegistered,false);
 for(const patch of [{dueDate:'2025-12-31'},{periodEnd:'2025-12-31'},{invoiceDate:'2026-02-30'},{lines:[{...doc.lines[0],quantityMilli:0}]},{lines:[{...doc.lines[0],vatRateBps:2000}]},{lines:[doc.lines[0],doc.lines[0]]},{currency:'USD'},{issuer:{...doc.issuer,vatRegistered:true}},{issuer:{...doc.issuer,vatNumber:'GB-SYNTHETIC'}}])assert.throws(()=>validateClientInvoiceDocument({...doc,...patch},true));
 const vat={...doc,invoiceType:'vat',vatTaxPoint:'2026-01-31',issuer:{...doc.issuer,vatRegistered:true,vatNumber:'GB-SYNTHETIC'},lines:[{...doc.lines[0],vatRateBps:2000}]};assert.equal(clientInvoiceTotals(validateClientInvoiceDocument(vat,true)).totalPence,12000);
});
test('quantity and tax use exact half-up per-line pence; configured zero rates stay zero',()=>{
 const doc=invoiceDocument();doc.invoiceType='vat';doc.vatTaxPoint='2026-01-31';doc.issuer={...doc.issuer,vatRegistered:true,vatNumber:'SYNTHETIC'};doc.lines=[{...doc.lines[0],quantityMilli:500,unitPricePence:101,vatRateBps:2000},{...doc.lines[0],id:uuid(2),quantityMilli:1000,unitPricePence:103,vatRateBps:500}];
 assert.deepEqual(clientInvoiceTotals(doc).lines.map(l=>[l.netPence,l.vatPence]),[[51,10],[103,5]]);assert.equal(clientInvoiceTotals(doc).totalPence,169);
 assert.equal(clientInvoiceDecimal('1.005',3,10000),1005);assert.equal(clientInvoiceDecimal('1.05',2,10000),105);assert.throws(()=>clientInvoiceDecimal('1.005',2,10000));assert.throws(()=>clientInvoiceDecimal('-1',2,10000));
});
test('each mutation has stable identity, revision and explicit confirmation, with no spoofed status retained',()=>{
 const request={requestId:uuid(1),id:uuid(2),blockId:1,expectedRevision:1,action:'Issue',confirmed:true,status:'Paid'};assert.equal(validateClientInvoiceRequest(request).status,undefined);
 for(const patch of [{confirmed:false},{requestId:'bad'},{blockId:0},{expectedRevision:1.5},{action:'Send'}])assert.throws(()=>validateClientInvoiceRequest({...request,...patch}));
 assert.throws(()=>validateClientInvoiceRequest({...request,action:'Void',reason:'x'}));assert.throws(()=>validateClientInvoiceRequest({...request,action:'Void',reason:'Unsupported 中文'}));
});
test('saved PDF is deterministic, draft-marked, escaped, complete and uses issued number only after issue',()=>{
 const doc=invoiceDocument();doc.client.name='Client (example) \\ end';doc.notes='Text /OpenAction /JavaScript';const row=invoiceRecord({document:doc});const draft=buildClientInvoicePdf(row);assert.match(draft.content.toString('latin1'),/^%PDF-1.4/);assert.match(draft.text,/DRAFT - NOT ISSUED/);assert.match(draft.text,/Unassigned - draft only/);assert.equal(draft.sha256,buildClientInvoicePdf(row).sha256);
 const issued={...row,status:'Issued',invoice_number:'MCI-00000001',issued_at:'2026-01-01T12:00:00Z'};const pdf=buildClientInvoicePdf(issued);assert.match(pdf.text,/MCI-00000001/);assert.doesNotMatch(pdf.text,/DRAFT - NOT ISSUED/);assert.match(pdf.content.toString('latin1'),/Client \\\(example\\\) \\\\ end/);assert.throws(()=>buildClientInvoicePdf({...issued,total_pence:1}),/totals/);
 const text=pdf.content.toString('latin1'),offset=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(offset,offset+4),'xref');
});
test('void and historical issued PDFs stay distinct, multi-page detail is retained and unsupported text fails closed',()=>{
 const row=invoiceRecord({status:'Issued',invoice_number:'MCI-00000002',issued_at:'2026-01-01T12:00:00Z'});const original=buildClientInvoicePdf(row);assert.match(buildClientInvoicePdf({...row,status:'Voided',void_reason:'Superseded after review',voided_at:'2026-01-02'}).text,/VOIDED CLIENT INVOICE/);assert.equal(buildClientInvoicePdf(row).sha256,original.sha256);
 const long=invoiceDocument();long.lines=Array.from({length:50},(_,i)=>({...long.lines[0],id:uuid(i+1),description:'Long management service detail '.repeat(10)}));const pdf=buildClientInvoicePdf(invoiceRecord({document:long}));assert.ok((pdf.content.toString('latin1').match(/\/Type \/Page\s/g)||[]).length>1);assert.match(pdf.text,/50\./);
 const invalid=invoiceDocument();invalid.client.name='中文';assert.throws(()=>validateClientInvoiceDocument(invalid,true),/supports Western/);
});
test('invoice type is explicitly selected and supply date is independent of billing period',()=>{
 const draft=blankClientInvoice('2026-01-01');assert.equal(draft.invoiceType,'unselected');assert.equal(draft.supplyDate,'');assert.equal(draft.vatTaxPoint,'');
 for(const patch of [{invoiceType:'unselected'},{invoiceType:'unknown'},{supplyDate:''},{supplyDate:'2026-02-30'},{vatTaxPoint:'2026-01-01'},{issuer:{...invoiceDocument().issuer,vatRegistered:true}}])assert.throws(()=>validateClientInvoiceDocument({...invoiceDocument(),...patch},true));
 const doc=invoiceDocument();doc.supplyDate='2026-02-01';assert.equal(validateClientInvoiceDocument(doc,true).supplyDate,'2026-02-01');
});
test('supplier contact email or validated phone is required at review with no contact assumption',()=>{
 const doc=invoiceDocument();doc.issuer.email='';assert.doesNotThrow(()=>validateClientInvoiceDocument(doc));assert.throws(()=>validateClientInvoiceDocument(doc,true),/supplier contact/);
 doc.issuer.phone='+44 (0)20 1234 5678';assert.equal(validateClientInvoiceDocument(doc,true).issuer.phone,doc.issuer.phone);
 for(const phone of ['abc','---','+1','020\n123','x'.repeat(81)])assert.throws(()=>validateClientInvoiceDocument({...doc,issuer:{...doc.issuer,phone}},true));
});
test('VAT invoice requires separately entered valid tax point and number without default rates',()=>{
 const doc=invoiceDocument();doc.invoiceType='vat';doc.issuer.vatRegistered=true;doc.issuer.vatNumber='SYNTHETIC';assert.throws(()=>validateClientInvoiceDocument(doc,true));
 doc.vatTaxPoint='2026-01-15';assert.equal(validateClientInvoiceDocument(doc,true).lines[0].vatRateBps,0);assert.throws(()=>validateClientInvoiceDocument({...doc,vatTaxPoint:'2026-02-30'},true));
 const pdf=buildClientInvoicePdf(invoiceRecord({document:doc}));assert.match(pdf.text,/Supply date: 2026-01-31/);assert.match(pdf.text,/VAT tax point: 2026-01-15/);assert.match(pdf.text,/VAT total \(GBP\):/);
});
test('non-VAT PDFs show contacts and supply date without implying a zero-rated VAT invoice',()=>{
 const doc=invoiceDocument();doc.issuer.phone='+44 20 1234 5678';const pdf=buildClientInvoicePdf(invoiceRecord({document:doc}));
 assert.match(pdf.text,/Contact email: issuer@example.invalid/);assert.match(pdf.text,/Contact phone: \+44 20 1234 5678/);assert.match(pdf.text,/Supply date: 2026-01-31/);assert.doesNotMatch(pdf.text,/VAT: 0%|VAT total|VAT tax point/);assert.match(pdf.text,/VAT is not charged/);
});
