import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/budget-xlsx.mjs';
import {parseBudgetWorkbook} from '../lib/budget-xlsx.ts';
import {inspectBudgetRows,buildBudgetPreview} from '../lib/budget-import.ts';
test('local workbook parses explicit sheets and cached totals without formula evaluation',async()=>{
 for(const stored of [false,true]){const w=await parseBudgetWorkbook(fixture({stored}));assert.deepEqual(w.sheets.map(s=>s.name),['Summary','Detail']);assert.equal(w.cachedFormulaCount,1);assert.equal(buildBudgetPreview(inspectBudgetRows(w.sheets[0].rows),1).totalPence,12345);}
});
test('ZIP and XML security limits reject malformed, encrypted, bombs, external, entity and path payloads',async()=>{
 for(const options of [{encrypted:true},{bomb:true},{external:true},{files:{'../bad':'bad'}},{files:{'xl/vbaProject.bin':'bad'}},{files:{'xl/workbook.xml':'<!DOCTYPE a [<!ENTITY x "bad">]><workbook/>'}},{files:{'xl/workbook.xml':'<a>'.repeat(65)+'</a>'.repeat(65)}},{sheet:'<row><c r="A1001"><v>1</v></c></row>'},{sheet:'<row><c r="BM1"><v>1</v></c></row>'},{sheet:'<row><c r="A1"/><c r="A1"/></row>'}])await assert.rejects(()=>parseBudgetWorkbook(fixture(options)));
 await assert.rejects(()=>parseBudgetWorkbook(new ArrayBuffer(2*1024*1024+1)));
 await assert.rejects(()=>parseBudgetWorkbook(new Uint8Array([1,2]).buffer));
 const corrupt=new Uint8Array(fixture({stored:true}));corrupt[60]^=1;await assert.rejects(()=>parseBudgetWorkbook(corrupt.buffer));
});
test('missing formula caches and errors cannot pass financial preview',async()=>{
 const base='<row><c r="A1" t="inlineStr"><is><t>CategoryName</t></is></c><c r="B1" t="inlineStr"><is><t>Budget</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Cleaning</t></is></c>';
 for(const value of ['<c r="B2"><f>1+1</f></c>','<c r="B2" t="e"><v>#REF!</v></c>','<c r="B2"><v>1.234</v></c>']){const w=await parseBudgetWorkbook(fixture({sheet:base+value+'</row>'}));assert.throws(()=>buildBudgetPreview(inspectBudgetRows(w.sheets[0].rows),1));}
});
test('dates are converted and floating noise normalized without rounding real fractional pennies',async()=>{
 const w=await parseBudgetWorkbook(fixture({sheet:'<row><c r="A1" t="inlineStr"><is><t>From</t></is></c><c r="B1"><v>46296</v></c></row><row><c r="A2"><v>1310.4000000000001</v></c><c r="B2"><v>1.234</v></c></row>'}));
 assert.equal(w.sheets[0].rows[0][1],'2026-10-01');assert.equal(w.sheets[0].rows[1][0],'1310.4');assert.equal(w.sheets[0].rows[1][1],'1.234');
});
test('category errors and missing category formula caches cannot become imported labels',async()=>{
 for(const label of ['<c r="A2" t="e"><v>#REF!</v></c>','<c r="A2"><f>BAD()</f></c>']){
  const w=await parseBudgetWorkbook(fixture({sheet:'<row><c r="A1" t="inlineStr"><is><t>CategoryName</t></is></c><c r="B1" t="inlineStr"><is><t>Budget</t></is></c></row><row>'+label+'<c r="B2"><v>123.45</v></c></row>'}));
  assert.throws(()=>buildBudgetPreview(inspectBudgetRows(w.sheets[0].rows),1),/Excel errors/);
 }
});
test('missing or raw-deflate-unsupported browser receives actionable guidance, never a raw constructor error',async()=>{
 const original=globalThis.DecompressionStream;
 try{
  globalThis.DecompressionStream=undefined;
  await assert.rejects(()=>parseBudgetWorkbook(fixture()),/up-to-date browser or export Summary as CSV/);
  globalThis.DecompressionStream=class {constructor(){throw new TypeError('unsupported format')}};
  await assert.rejects(()=>parseBudgetWorkbook(fixture()),/cannot read compressed XLSX files/);
 }finally{globalThis.DecompressionStream=original;}
});
