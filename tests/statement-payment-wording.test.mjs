import test from 'node:test';
import assert from 'node:assert/strict';
import {statementPaymentMessage,standardPaymentTerms} from '../lib/service-charge-document.ts';
test('zero and credit balances do not request payment even with custom terms',()=>{
 for(const balance of [0,-100])for(const ready of [false,true]){
  const text=statementPaymentMessage(balance,0,ready,standardPaymentTerms);
  assert.match(text,/No payment is currently due/);
  assert.doesNotMatch(text,/28 days|charges have now been applied/i);
  assert.doesNotMatch(statementPaymentMessage(balance,0,ready,'Pay immediately'),/Pay immediately/);
 }
});
test('future balances and incomplete documents do not invent payment deadlines',()=>{
 assert.match(statementPaymentMessage(100,0,true,standardPaymentTerms),/No payment is currently due/);
 const text=statementPaymentMessage(100,100,false,standardPaymentTerms);
 assert.match(text,/not a payment demand/);assert.doesNotMatch(text,/28 days/);
 assert.equal(statementPaymentMessage(100,100,true,'Reviewed terms'),'Reviewed terms');
});
