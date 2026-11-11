import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {budgetAttachmentReview,captureBudgetAttachment,BUDGET_XLSX_MEDIA_TYPE,MAX_BUDGET_ATTACHMENT_BYTES} from '../lib/budget-attachment.ts';
// Fabricated bytes exercise integrity only, not workbook parsing or safety scanning.
const bytes=Uint8Array.from([80,75,3,4,10,20]);
const version={versionId:'budget-v1',blockId:1,yearStart:'2026-10-01',yearEnd:'2027-09-30',budgetRevision:2,fileName:'budget.xlsx',mediaType:BUDGET_XLSX_MEDIA_TYPE,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
const input=()=>({version,bytes,blockId:1,yearStart:version.yearStart,budgetRevision:2,reviewToken:budgetAttachmentReview(version).reviewToken,wholeWorkbookApproved:true});
test('captures exact original bytes and immutable reviewed version',()=>{
 const snapshot=captureBudgetAttachment(input());
 assert.deepEqual(Buffer.from(snapshot.content,'base64'),Buffer.from(bytes));
 assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.budgetVersion));
 assert.equal(snapshot.budgetVersion.sha256,version.sha256);
});
test('rejects another building/year, stale budget revision and unreviewed workbook',()=>{
 for(const patch of [{blockId:2},{yearStart:'2027-10-01'},{budgetRevision:3},{wholeWorkbookApproved:false},{reviewToken:'other'}])assert.throws(()=>captureBudgetAttachment({...input(),...patch}));
});
test('changing any version identity invalidates its prior review',()=>{
 for(const patch of [{versionId:'budget-v2'},{fileName:'revised.xlsx'},{sha256:'a'.repeat(64)},{byteLength:7},{budgetRevision:3},{blockId:2}])assert.notEqual(budgetAttachmentReview({...version,...patch}).reviewToken,budgetAttachmentReview(version).reviewToken);
 assert.throws(()=>captureBudgetAttachment({...input(),version:{...version,versionId:'budget-v2'}}));
});
test('integrity rejects changed or missing original bytes',()=>{
 assert.throws(()=>captureBudgetAttachment({...input(),bytes:new Uint8Array([80,75,3,4,10,21])}));
 assert.throws(()=>captureBudgetAttachment({...input(),bytes:new Uint8Array()}));
});
test('validates type, size, filename, year and hash without claiming archive safety',()=>{
 for(const patch of [{mediaType:'application/pdf'},{fileName:'budget.xlsm'},{fileName:'../budget.xlsx'},{fileName:'bad\n.xlsx'},{byteLength:MAX_BUDGET_ATTACHMENT_BYTES+1},{byteLength:0},{sha256:'bad'},{yearEnd:'2027-10-01'},{yearStart:'2026-02-30'},{versionId:''}])assert.throws(()=>budgetAttachmentReview({...version,...patch}));
});
test('old captured historical attachment remains exact after caller mutates bytes',()=>{
 const source=Uint8Array.from(bytes);const captured=captureBudgetAttachment({...input(),bytes:source});source[4]=99;
 assert.deepEqual(Buffer.from(captured.content,'base64'),Buffer.from(bytes));
});
