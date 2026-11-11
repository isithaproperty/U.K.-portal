/** Disposable embedded PostgreSQL only; does not connect to hosted databases.
 * PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/run-pglite-budget-spend.mjs
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE to the installed official PGlite module.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
const query=(sql,args)=>db.query(sql,args);
async function as(email){await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"${email}@example.invalid"}',false)`);}
const value={version:1,blockId:1,yearStart:'2026-01-01',assignments:[]};
const save=(block,area,state,revision)=>query('select * from public.save_management_review($1,$2,$3::jsonb,$4)',[block,area,JSON.stringify(state),revision]);
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);
try{
 for(const file of ['tests/sql/management-review-bootstrap.sql','supabase/management_review.sql','tests/sql/supplier-settlements-bootstrap.sql','supabase/supplier_settlements.sql','supabase/ongoing_work_orders.sql','supabase/budget_spend.sql','tests/sql/management-review-assertions.sql','tests/sql/supplier-settlements-assertions.sql'])await db.exec(await readFile(file,'utf8'));
 console.log('PASS: existing review and supplier-settlement regression SQL after both new migrations');
 await db.exec("insert into public.portal_members values('admin@example.invalid','admin',null)");
 await as('manager');
 for(const area of ['financials','leaseholders'])await save(1,area,{preserved:area},0);
 const before=(await query("select * from public.management_review_state where area<>'budget-spend' order by block_id,area")).rows;
 const auditBefore=(await query("select * from public.management_review_history where area<>'budget-spend' order by block_id,area,revision")).rows;
 let result=await save(1,'budget-spend',value,0);assert.equal(Number(result.rows[0].revision),1);
 await rejects(save(1,'budget-spend',{...value,assignments:[{workOrderId:101,categoryId:'stale'}]},0),'40001');
 await rejects(save(2,'budget-spend',{...value,blockId:2},0),'42501');
 result=await save(1,'budget-spend',{...value,assignments:[{workOrderId:101,categoryId:'cleaning'}]},1);assert.equal(Number(result.rows[0].revision),2);
 await rejects(save(1,'budget-spend',value,1),'40001');
 const audit=(await query("select revision,updated_by,state from public.management_review_history where area='budget-spend' order by revision")).rows;
 assert.equal(audit.length,2);assert.deepEqual(audit.map(row=>Number(row.revision)),[1,2]);assert.ok(audit.every(row=>row.updated_by==='manager@example.invalid'));assert.deepEqual(audit[0].state,value);
 await rejects(query("update public.management_review_history set state='{}' where area='budget-spend'"),'42501');
 await assert.rejects(query("update public.management_review_state set area='financials',revision=revision+1 where area='budget-spend'"),/Invalid revision or scope change/);
 await rejects(save(1,'invented-area',{},0),'P0001');
 await rejects(save(1,'budget-spend',[],2),'P0001');
 await rejects(save(1,'budget-spend',{huge:'x'.repeat(1500000)},2),'P0001');
 assert.deepEqual((await query("select * from public.management_review_state where area<>'budget-spend' order by block_id,area")).rows,before);
 assert.deepEqual((await query("select * from public.management_review_history where area<>'budget-spend' order by block_id,area,revision")).rows,auditBefore);
 await as('other');
 assert.equal((await query("select * from public.management_review_state where area='budget-spend'")).rows.length,0);
 assert.equal((await query("select * from public.management_review_history where area='budget-spend'")).rows.length,0);
 await rejects(save(1,'budget-spend',value,2),'42501');
 await save(2,'budget-spend',{...value,blockId:2},0);
 await as('tenant');assert.equal((await query("select * from public.management_review_state where area='budget-spend'")).rows.length,0);await rejects(save(1,'budget-spend',value,2),'42501');
 await as('admin');assert.equal((await query("select * from public.management_review_state where area='budget-spend'")).rows.length,2);await save(1,'budget-spend',value,2);
 await as('owner');await save(2,'budget-spend',{...value,blockId:2},1);
 const auditAll=(await query("select block_id,revision from public.management_review_history where area='budget-spend'")).rows;assert.equal(auditAll.length,5);
 await db.exec('reset role;set role anon');
 await rejects(query("select * from public.management_review_state where area='budget-spend'"),'42501');await rejects(save(1,'budget-spend',value,3),'42501');
 console.log('PASS: budget-spend scope, owner/admin access, tenant/anonymous denial, first-save/update collisions, immutable audit, payload limits, and other review areas unchanged');
}finally{await db.close();}
