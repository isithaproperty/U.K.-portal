import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../app/api/blocks/[blockId]/route.ts',import.meta.url),'utf8');
test('block editor preserves units and residents and rejects stale edits',()=>{
 assert.match(route,/original\[field\]!==current\[field\]/);
 assert.match(route,/query=query.eq\(field,current\[field\]\)/);
 assert.match(route,/details.units<Number\(current.units\)/);
 assert.match(route,/Number\(update.units\)<count/);
 assert.doesNotMatch(route,/\.delete\(|\.insert\(|\.upsert\(/);
});
test('block editing checks current and target portfolio access',()=>{
 assert.match(route,/canManageReviewBlock\(member,String\(current.manager\)\)/);
 assert.match(route,/canManageReviewBlock\(member,String\(update.manager\)\)/);
});
test('block dashboard exposes the existing non-destructive unit importer',()=>{
 const ui=readFileSync(new URL('../app/BlockDashboard.tsx',import.meta.url),'utf8');
 assert.match(ui,/Edit block &amp; add units/);
 assert.match(ui,/<UnitRegister blocks=\{\[block\]\}/);
});
