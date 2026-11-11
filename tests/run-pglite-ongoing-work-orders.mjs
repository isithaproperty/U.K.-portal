/** Disposable embedded PostgreSQL only. No hosted database access.
 * PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/run-pglite-ongoing-work-orders.mjs
 */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
if(!process.env.PGLITE_MODULE)throw new Error('Set PGLITE_MODULE to the official installed PGlite module.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
const exec=sql=>db.exec(sql);
const as=async(email)=>{await exec(`reset role;set role authenticated;select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","email":"${email}@example.invalid"}',false)`);};
const invoice=(id,wo=201,amount=10000)=>({id,workOrderId:wo,contractorId:9,number:id,amountPence:amount,invoiceDate:'2026-01-01',dueDate:'2026-01-31'});
let invoices=[];let revision=1;
const save=async(list)=>{await db.query("select * from public.save_management_review(1,'creditors',$1::jsonb,$2)",[JSON.stringify({invoices:list,payments:[]}),revision]);revision++;invoices=list;};
const request=(n,id,amount=10000)=>({requestId:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,revision,bankTransactionId:`ongoing-bank-${n}`,paymentDate:'2026-01-05',amountPence:amount,evidence:'Checked synthetic bank statement',confirmedActualPayment:true,allocations:[{invoiceId:id,amountPence:amount}]});
const pay=r=>db.query('select public.record_supplier_settlement(1,$1::jsonb)',[JSON.stringify(r)]);
const row=async()=> (await db.query('select * from public.work_orders where id=201')).rows[0];
try{
 for(const file of ['tests/sql/management-review-bootstrap.sql','supabase/management_review.sql','tests/sql/supplier-settlements-bootstrap.sql','supabase/supplier_settlements.sql','supabase/ongoing_work_orders.sql','tests/sql/supplier-settlements-assertions.sql'])await exec(await readFile(file,'utf8'));
 console.log('PASS: existing ordinary settlement regression assertions with migration applied');
 await exec("insert into public.work_orders(id,block_id,contractor_id,status,payment_status,actual_cost,is_ongoing) values(201,1,9,'Open','Not approved',1200,true),(202,1,9,'Open','Not approved',100,false)");
 await as('manager');await exec("update public.work_orders set payment_status='Approved' where id=201");
 await assert.rejects(exec("update public.work_orders set payment_status='Approved' where id=202"),/Complete ordinary work/);
 await assert.rejects(exec("update public.work_orders set is_ongoing=true where id=202"),/fixed when/);
 await assert.rejects(pay(request(201,'january')),/Owner access required/);
 await as('other');assert.equal((await db.query('update public.work_orders set status=\'Complete\' where id=201 returning id')).rows.length,0);
 await as('tenant');assert.equal((await db.query('update public.work_orders set status=\'Complete\' where id=201 returning id')).rows.length,0);
 await assert.rejects(pay(request(201,'january')),/Owner access required/);
 await as('owner');
 const current=(await db.query("select state,revision from public.management_review_state where block_id=1 and area='creditors'")).rows[0];
 revision=Number(current.revision);invoices=current.state.invoices;
 await save([...invoices,invoice('january'),invoice('ordinary-open',202)]);
 await assert.rejects(pay(request(202,'ordinary-open')),/Complete and approve/);
 await assert.rejects(exec("update public.work_orders set status='Complete' where id=201"),/Settle all saved invoices/);
 const first=request(201,'january');await pay(first);await pay(first);
 assert.equal((await row()).status,'Open');assert.equal((await row()).payment_status,'Approved');assert.equal((await row()).paid_at,null);
 await save([...invoices,invoice('february')]);
 await assert.rejects(exec("update public.work_orders set status='Complete' where id=201"),/Settle all saved invoices/);
 await pay(request(203,'february',4000));
 await assert.rejects(exec("update public.work_orders set status='Complete' where id=201"),/Settle all saved invoices/);
 await pay(request(204,'february',6000));assert.equal((await row()).status,'Open');
 await assert.rejects(exec("update public.work_orders set payment_status='Paid' where id=201"),/recorded per invoice/);
 await assert.rejects(save(invoices.map(inv=>inv.id==='january'?{...inv,amountPence:9999}:inv)),/Cannot change an invoice/);
 await as('manager');await exec("update public.work_orders set status='Complete' where id=201");assert.equal((await row()).status,'Complete');
 await assert.rejects(exec("update public.work_orders set status='Open' where id=201"),/cannot be reopened/);
 await assert.rejects(save([...invoices,invoice('march')]),/Cannot add or change invoices/);
 await as('owner');await assert.rejects(pay(request(205,'february',1)),/Complete and approve/);
 await exec("reset role;insert into public.work_orders(id,block_id,contractor_id,status,payment_status,actual_cost,is_ongoing) values(203,2,9,'Open','Not approved',100,true)");
 await as('owner');await exec("update public.work_orders set status='Complete' where id=203");
 await assert.rejects(db.query("select * from public.save_management_review(2,'creditors',$1::jsonb,0)",[JSON.stringify({invoices:[invoice('late-first-invoice',203)],payments:[]})]),/Cannot add or change invoices/);
 console.log('PASS: immutable type, ordinary completion guard, owner-only payment, scoped closure, two monthly invoices, partial settlement, replay, no auto-close, explicit close, closed invoice/reopen guards');
}finally{await db.close();}
