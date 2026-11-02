import test from 'node:test';import assert from 'node:assert/strict';
import {canManageReviewBlock,isReviewArea,validateReviewWrite,validateReviewState} from '../lib/management-review.ts';
test('review permission boundaries require explicit manager scope',()=>{
 assert.equal(canManageReviewBlock(null,'London'),false);
 for(const role of ['resident','contractor','unknown']) assert.equal(canManageReviewBlock({role,portfolio_manager:'London'},'London'),false);
 assert.equal(canManageReviewBlock({role:'manager',portfolio_manager:'Other'},'London'),false);
 assert.equal(canManageReviewBlock({role:'manager',portfolio_manager:null},'London'),false);
 assert.equal(canManageReviewBlock({role:'manager',portfolio_manager:'London'},'London'),true);
 assert.equal(canManageReviewBlock({role:'owner',portfolio_manager:null},'London'),true);
 assert.equal(canManageReviewBlock({role:'admin',portfolio_manager:null},'London'),true);
});
test('review writes require a loaded revision and typed area',()=>{
 for(const area of ['other','constructor','../creditors']) assert.equal(isReviewArea(area),false);
 assert.equal(isReviewArea('creditors'),true);
 for(const body of [null,[],{}, {state:{},revision:-1},{state:{},revision:0.5},{state:[],revision:0}]) assert.throws(()=>validateReviewWrite(body));
 assert.deepEqual(validateReviewWrite({state:{},revision:0}),{state:{},revision:0});
});
test('server review validator refuses cross-block financial recipients and forged debtor delivery',()=>{
 assert.throws(()=>validateReviewState('debtors',{notes:{999:'Other block'},history:[],mode:'Payment allocation review',receipt:''},1,[10],'2026-11-02'));
 assert.throws(()=>validateReviewState('creditors',{invoices:[{workOrderId:999}],payments:[]},1,[10],'2026-11-02',[]));
});
