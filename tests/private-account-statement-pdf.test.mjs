import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPrivateAccountStatement} from '../lib/private-account-statement-pdf.ts';
const entry=(id,patch={})=>({id,block_id:1,unit_id:10,entry_type:'Charge',amount_pence:10000,entry_date:'2026-01-01',due_date:'2026-01-05',reference:'Q1',description:'Service charge',...patch});
const input={block:{id:1,name:'Example Court'},unit:{id:10,blockId:1,unitNumber:'1A',paymentReference:'EX-1A'},asOf:'2026-02-01',entries:[entry(1),entry(2,{entry_type:'Payment',amount_pence:2500,entry_date:'2026-01-20',due_date:null}),entry(3,{entry_type:'Credit',amount_pence:500,entry_date:'2026-01-21',due_date:null})]};
test('deterministic scoped full-history statement includes partial payments and credits',()=>{
 const result=buildPrivateAccountStatement(input);assert.deepEqual(result,buildPrivateAccountStatement({...input,entries:[...input.entries].reverse()}));
 assert.equal(result.summary.balance,7000);assert.equal(result.summary.due,7000);assert.equal(result.summary.overdue,7000);
 assert.match(result.text,/Opening balance .*£0.00/);assert.match(result.text,/Running balance: £75.00/);assert.match(result.text,/Running balance: £70.00/);
 assert.match(result.text,/Recorded due date: 2026-01-05/);assert.match(result.text,/Reference: Q1/);assert.match(result.text,/not a payment demand/);
 assert.equal(result.attachment.mediaType,'application/pdf');assert.equal(result.attachment.encoding,'base64');assert.ok(Object.isFrozen(result.attachment));
 assert.deepEqual(input.entries.map(e=>e.id),[1,2,3]);
});
test('future rows excluded; today due is not overdue; missing dates never invented',()=>{
 const result=buildPrivateAccountStatement({...input,entries:[entry(1,{due_date:input.asOf}),entry(2,{due_date:null}),entry(3,{entry_date:'2026-02-02',description:'FUTURE PRIVATE'})]});
 assert.equal(result.summary.balance,20000);assert.equal(result.summary.due,10000);assert.equal(result.summary.overdue,0);assert.doesNotMatch(result.text,/FUTURE PRIVATE/);assert.match(result.text,/Recorded due date: Not recorded/);
});
test('credits and empty accounts do not imply an amount payable',()=>{
 const credit=buildPrivateAccountStatement({...input,entries:[entry(1,{entry_type:'Credit',due_date:null})]});assert.equal(credit.summary.balance,-10000);assert.equal(credit.summary.due,0);assert.match(credit.text,/Account in credit: £100.00/);
 assert.match(buildPrivateAccountStatement({...input,entries:[]}).text,/No recorded movements/);
});
test('strict scope, duplicate IDs, dates, controls, unsafe sums and Unicode fail closed',()=>{
 for(const entries of [[entry(1,{unit_id:11})],[entry(1,{block_id:2})],[entry(1),entry(1)],[entry(1,{amount_pence:0})],[entry(1,{amount_pence:1.5})],[entry(1,{entry_date:'2026-02-30'})],[entry(1,{description:'secret\nline'})],[entry(1,{description:'😀'})],[entry(1,{amount_pence:Number.MAX_SAFE_INTEGER}),entry(2)]])assert.throws(()=>buildPrivateAccountStatement({...input,entries}));
 assert.throws(()=>buildPrivateAccountStatement({...input,unit:{...input.unit,blockId:2}}));
 assert.throws(()=>buildPrivateAccountStatement({...input,asOf:'2026-02-30'}));
});
test('PDF escaping, valid cross references and pagination preserve final entries',()=>{
 const result=buildPrivateAccountStatement({...input,entries:Array.from({length:30},(_,i)=>entry(i+1,{description:i===29?'FINAL café (test) \\ André “quote”':'Line '+i}))});
 const pdf=Buffer.from(result.attachment.content,'base64').toString('latin1');assert.match(pdf,/\\\(test\\\) \\\\ André/);assert.match(pdf,/\/Count [2-9]/);
 const xref=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(xref,xref+4),'xref');
 for(const match of pdf.matchAll(/(\d{10}) 00000 n/g))assert.match(pdf.slice(Number(match[1])),/^\d+ 0 obj/);
 assert.match(result.text,/FINAL café/);assert.doesNotMatch(pdf,/\/JavaScript|\/OpenAction|\/EmbeddedFile/);
});
test('Poppler extracts real PDF text including escaping and final page when available',t=>{
 try{execFileSync('pdftotext',['-v'],{stdio:'ignore'});}catch{t.skip('Poppler unavailable');return;}
 const dir=mkdtempSync(join(tmpdir(),'account-statement-'));
 try{const result=buildPrivateAccountStatement({...input,entries:Array.from({length:20},(_,i)=>entry(i+1,{description:i===19?'FINAL café (test) \\ André':'Entry '+i}))});const path=join(dir,'statement.pdf');writeFileSync(path,Buffer.from(result.attachment.content,'base64'));const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});assert.match(text,/FINAL café \(test\) \\ André/);assert.match(text,/Closing account balance: £2000.00/);assert.match(text,/Page 4 of 4/);}finally{rmSync(dir,{recursive:true,force:true});}
});
