import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetFileMessage} from '../lib/budget-upload-status.ts';
import {readFile} from 'node:fs/promises';
test('selection feedback retains filename through reading, success, and failure without claiming server upload',()=>{
 assert.equal(budgetFileMessage({name:'sample.xlsx',phase:'reading'},''),'Reading sample.xlsx…');
 assert.equal(budgetFileMessage({name:'sample.xlsx',phase:'ready'},'Next: choose the worksheet.'),'Read sample.xlsx successfully in this browser. Next: choose the worksheet.');
 assert.equal(budgetFileMessage({name:'sample.xlsx',phase:'error',error:'Invalid ZIP.'},''),'Could not read sample.xlsx: Invalid ZIP.');
});
test('chooser retains feedback independently of same-file retry input reset',async()=>{
 const source=await readFile(new URL('../app/BudgetCsvImport.tsx',import.meta.url),'utf8');
 assert.match(source,/setFileStatus\({name:file.name,phase:"reading"}\)/);
 assert.match(source,/setFileStatus\({name:file.name,phase:"ready"}\)/);
 assert.match(source,/setFileStatus\({name:file.name,phase:"error"/);
 assert.match(source,/event.target.value=""/);
 assert.match(source,/setBudgetFile\(null\);setSharesFile\(null\)/);
 assert.match(source,/Next: choose the budget worksheet below/);
 assert.match(source,/Next: choose the annual budget column below/);
 assert.match(source,/aria-busy={busy}/);
 assert.match(source,/catch\(e\){if\(version===generation.current\)setFileStatus/);
 assert.match(source,/finally{if\(version===generation.current\){fileLock.current=false;setBusy\(false\);}}/);
 assert.match(source,/function reset\(\){generation.current\+\+;fileLock.current=false;setBusy\(false\)/);
});
