import test from 'node:test';
import assert from 'node:assert/strict';
import {canViewSyntheticReview} from '../lib/review-access.ts';
test('synthetic preview fails closed outside explicit development opt-in',()=>{
 for(const mode of ['production','test',undefined]) assert.equal(canViewSyntheticReview(mode,'1'),false);
 for(const flag of [undefined,'','true','0']) assert.equal(canViewSyntheticReview('development',flag),false);
 assert.equal(canViewSyntheticReview('development','1'),true);
});
