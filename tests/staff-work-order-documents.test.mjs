import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {staffDocumentExtension,validateStaffDocument} from '../lib/staff-work-order-documents.ts';
test('staff attachment type, empty/oversized file and filename validation',()=>{
 for(const [type,extension] of [['application/pdf','pdf'],['image/jpeg','jpg'],['image/png','png']])assert.equal(staffDocumentExtension({type,name:'a',size:1}),extension);
 for(const patch of [{type:'text/html'},{size:0},{size:10485761},{name:' '},{name:'x'.repeat(201)}])assert.throws(()=>staffDocumentExtension({type:'application/pdf',name:'invoice.pdf',size:1,...patch}));
 assert.equal(staffDocumentExtension({type:'application/pdf',name:'invoice.pdf',size:10485760}),'pdf');
});
test('staff file signature matches declared MIME',async()=>{
 assert.equal(await validateStaffDocument(new File(['%PDF-1.4'], 'invoice.pdf',{type:'application/pdf'})),'pdf');
 assert.equal(await validateStaffDocument(new File([new Uint8Array([255,216,255])], 'job.jpg',{type:'image/jpeg'})),'jpg');
 assert.equal(await validateStaffDocument(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'job.png',{type:'image/png'})),'png');
 await assert.rejects(validateStaffDocument(new File(['<html>'], 'invoice.pdf',{type:'application/pdf'})));
});
test('separate staff flow preserves contractor workflow and no send/payment side effects',async()=>{
 const source=await readFile(new URL('../app/StaffWorkOrderDocuments.tsx',import.meta.url),'utf8');
 assert.match(source,/lock.current=true/);assert.match(source,/upsert:false/);assert.match(source,/setUncertain\(true\)/);assert.match(source,/loadError\|\|uncertain/);
 assert.doesNotMatch(source,/functions\.invoke|payment_status|\.update\(|\.delete\(/);
 for(const route of ['work-orders/[id]','contractor/work-orders/[id]']){const page=await readFile(new URL(`../app/${route}/page.tsx`,import.meta.url),'utf8');assert.match(page,/<StaffWorkOrderDocuments/);assert.match(page,/<WorkOrderWorkflow/);assert.match(page,/loadError={!!staffDocumentError}/);}
});
