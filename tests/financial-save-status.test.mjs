import test from 'node:test';
import assert from 'node:assert/strict';
import {financialSaveLabel,financialSaveMessage} from '../lib/financial-save-status.ts';
test('blank and populated unprepared drafts never claim a prepared batch or a missing budget',()=>{
 for(const schedules of [[{name:'',amount:''}],[{name:'Reviewed budget',amount:'1234.56'}]]){
  const state={prepared:null,schedules};
  assert.equal(financialSaveLabel(state),'Save draft preparation');
  const text=financialSaveMessage(state,7);
  assert.match(text,/Draft preparation saved \(revision 7\)/);
  assert.match(text,/This draft has no prepared batch/);
  assert.match(text,/Any budget details already applied to this preparation are saved/);
  assert.doesNotMatch(text,/Budget and prepared batch saved|missing|not uploaded|no budget/i);
 }
});
test('actual prepared rows get batch confirmation, empty rows do not',()=>{
 const state={prepared:{rows:[{amountPence:12345}]}};
 assert.equal(financialSaveLabel(state),'Save budget & prepared batch');
 assert.match(financialSaveMessage(state,8),/Budget and prepared batch saved \(revision 8\)/);
 assert.match(financialSaveMessage(state,8),/No ledger entries or emails were created/);
 assert.equal(financialSaveLabel({prepared:{rows:[]}}),'Save draft preparation');
 assert.match(financialSaveMessage({prepared:{rows:[]}},9),/This draft has no prepared batch/);
});
