import test from 'node:test';
import assert from 'node:assert/strict';
import {canViewSyntheticReview} from '../lib/review-access.ts';
test('synthetic preview fails closed outside explicit development opt-in',()=>{
 for(const mode of ['production','test',undefined]) assert.equal(canViewSyntheticReview(mode,'1'),false);
 for(const flag of [undefined,'','true','0']) assert.equal(canViewSyntheticReview('development',flag),false);
 assert.equal(canViewSyntheticReview('development','1'),true);
});
import {isHostedReviewPreview,syntheticPreviewRequest} from '../lib/review-access.ts';
test('hosted demo requires both preview environment and exact isolated branch',()=>{
 assert.equal(isHostedReviewPreview('preview','review/london-management-adjustments'),true);
 for(const env of ['production','development',undefined])assert.equal(isHostedReviewPreview(env,'review/london-management-adjustments'),false);
 for(const branch of ['main','other',undefined])assert.equal(isHostedReviewPreview('preview',branch),false);
 assert.equal(canViewSyntheticReview('production',undefined,'preview','review/london-management-adjustments'),true);
 assert.equal(canViewSyntheticReview('production','1','production','review/london-management-adjustments'),false);
});
test('hosted demo blocks all mutations and APIs; live application pages redirect to demo',()=>{
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal(syntheticPreviewRequest(method,'/review'),'block');
 for(const path of ['/api/blocks/1/charges','/api/management-jobs','/api/management-delivery-events'])assert.equal(syntheticPreviewRequest('GET',path),'block');
 for(const path of ['/','/review','/_next/static/x.js','/aviaf-demand-logo.png'])assert.equal(syntheticPreviewRequest('GET',path),'allow');
 for(const path of ['/tenant','/login','/auth/callback','/work-orders/1'])assert.equal(syntheticPreviewRequest('GET',path),'redirect');
});
