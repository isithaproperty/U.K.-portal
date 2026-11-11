/** Synthetic embedded PostgreSQL integration test only. Never connects to hosted data.
 * Run from repository root with PGLITE_MODULE pointing to an installed local PGlite module.
 * Fixtures create a disposable database and mock auth/storage schemas, not real files.
 * Tests migration compatibility, accounting atomicity, reminder source locks and document isolation.
 */
import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE to a local installed PGlite module. No hosted database is used.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);const db=new PGlite();
const file=async p=>db.exec(await readFile(p,'utf8'));
const scalar=async sql=>(await db.query(sql)).rows[0].n;
try{
 for(const p of ['tests/sql/management-review-bootstrap.sql','tests/sql/management-financial-bootstrap.sql','supabase/service_charges.sql','supabase/automatic_invoice_numbers.sql','supabase/management_review.sql','tests/sql/supplier-settlements-bootstrap.sql','supabase/supplier_settlements.sql','supabase/bank_reconciliation.sql','supabase/building_cashflow.sql'])await file(p);
 await db.exec("alter table work_orders add column work_order_number text;update work_orders set work_order_number='WO-'||id;");
 await db.exec("alter table blocks add name text default 'Synthetic Court',add address text default 'Example Road'; create table contractors(id bigint primary key,email text); insert into contractors values (9,'contractor@example.invalid'),(10,'othercontractor@example.invalid'); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;");
 await file('tests/sql/management-dispatch-bootstrap.sql');await file('supabase/management_dispatch.sql');await file('supabase/bulk_reminder_dispatch.sql');await file('supabase/work_order_workflow.sql');await file('supabase/contractor_upload_only.sql');await file('docs/proposed-staff-work-order-documents.sql');await file('docs/proposed-whole-block-reconciliation.sql');
 await db.exec("grant all on all tables in schema public to service_role;grant usage,select on all sequences in schema public to service_role;");
 console.log('PASS 1/6: all proposed migrations and existing work-order storage policies coexist in dependency order.');
 const user=async email=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:'00000000-0000-0000-0000-000000000001',email:email+'@example.invalid'})]);await db.exec('set role authenticated');};
 await user('owner');
 await db.query('select save_management_review(1,\'creditors\',$1,0)',[JSON.stringify({invoices:[{id:'i1',workOrderId:101,contractorId:9,number:'INV-1',amountPence:10000}],payments:[]})]);
 const stage=async(id,amount,reference='WO-101')=>db.query('select stage_block_statement(1,$1)',[JSON.stringify([{fingerprint:String(id).padStart(64,'0'),transaction_date:'2026-01-05',amount_pence:amount,bank_reference:reference,description:'Synthetic bank row',transaction_id:'bank-'+id,source_file:'test.csv'}])]);
 await stage(1,5000,'RESIDENT');await stage(2,-4000);await stage(3,-6000);await stage(4,-1,'BANK FEE');await stage(2,-4000);
 assert.equal(await scalar('select count(*)::int n from building_cashflow_rows'),4);assert.equal(await scalar('select count(*)::int n from bank_statement_rows'),1);
 const approve=async(ids,residents=[])=>db.query('select approve_block_statement(1,$1,$2,1,true)',[JSON.stringify(residents),JSON.stringify(ids.map(id=>({id,invoiceId:'i1'})))]);
 const outgoing=(await db.query('select id from building_cashflow_rows where transaction_id=\'bank-2\'')).rows[0].id;
 await user('manager');await assert.rejects(approve([outgoing]),e=>e.code==='42501');
 await user('other');await assert.rejects(approve([outgoing]),e=>e.code==='42501');
 await user('owner');
 await stage(5,-11000);await stage(6,-100,'WO-101 WO-103');await stage(7,-100,'WO-1011');
 for(const bankId of ['bank-5','bank-6','bank-7']){
  const id=(await db.query('select id from building_cashflow_rows where transaction_id=$1',[bankId])).rows[0].id;
  await assert.rejects(approve([id]));
 }
 await assert.rejects(db.query("select approve_block_statement(1,'[]',$1,99,true)",[JSON.stringify([{id:outgoing,invoiceId:'i1'}]) ]));
 await assert.rejects(db.query("select approve_block_statement(1,'[]',$1,1,false)",[JSON.stringify([{id:outgoing,invoiceId:'i1'}]) ]));
 assert.equal(await scalar('select count(*)::int n from supplier_settlements'),0);
 // A failed resident assignment rolls back the contractor settlement in the same batch.
 const resident=(await db.query('select id from bank_statement_rows')).rows[0].id;
 await assert.rejects(approve([outgoing],[{id:resident,unit_id:9999}]));assert.equal(await scalar('select count(*)::int n from supplier_settlements'),0);
 await approve([outgoing],[{id:resident,unit_id:10}]);assert.equal(await scalar('select count(*)::int n from supplier_settlements'),1);
 assert.equal((await db.query('select payment_status from work_orders where id=101')).rows[0].payment_status,'Approved');
 await approve([outgoing]);assert.equal(await scalar('select count(*)::int n from supplier_settlements'),1);
 const remainder=(await db.query('select id from building_cashflow_rows where transaction_id=\'bank-3\'')).rows[0].id;
 await approve([remainder]);assert.equal((await db.query('select payment_status from work_orders where id=101')).rows[0].payment_status,'Paid');
 assert.equal(await scalar('select count(*)::int n from bank_contractor_reconciliations'),2);
 
 console.log('PASS 2/6: atomic import, observation/receipt dedupe, scoped owner authority, mixed rollback, partial/full settlement and exact replay.');
 // Integrated reminder lock must roll back both sides of a mixed approval.
 await user('owner');
 await db.query("select save_management_review(1,'creditors',$1,1)",[JSON.stringify({invoices:[{id:'i1',workOrderId:101,contractorId:9,number:'INV-1',amountPence:10000},{id:'i3',workOrderId:103,contractorId:9,number:'INV-3',amountPence:20000}],payments:[]})]);
 await db.query("select save_management_review(1,'leaseholders',$1,0)",[JSON.stringify({contacts:[{id:'c10',blockId:1,unitId:10,name:'Synthetic',role:'Leaseholder',emails:['one@example.invalid'],communications:true,demands:true}],consultations:[]})]);
 await db.exec("insert into service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by) values(1,10,'Charge','Synthetic debt',20000,current_date-10,current_date-5,'charge-review','owner@example.invalid')");
 await stage(20,1000,'RESIDENT');await stage(21,-20000,'WO-103');
 const incoming=(await db.query("select id from bank_statement_rows where transaction_id='bank-20'")).rows[0].id;
 const outgoing103=(await db.query("select id from building_cashflow_rows where transaction_id='bank-21'")).rows[0].id;
 const snapshot=(await db.query('select read_bulk_reminder_snapshot(1) s')).rows[0].s;
 const bytes=Buffer.from('%PDF-1.4 synthetic only'),{createHash}=await import('node:crypto');
 const key='mgmt-v1-integrated-lock-review';const envelope={idempotencyKey:key,operationId:'bulk-reminder:'+snapshot.asOf+':integrated',kind:'Overdue account reminder',blockId:1,unitId:10,to:'one@example.invalid',subject:'Synthetic',body:'Only unit ten',attachments:[{fileName:'private.pdf',mediaType:'application/pdf',encoding:'base64',content:bytes.toString('base64')}],sourceEvidence:{contactRevision:snapshot.contactRevision,bulkReminder:{ledgerRevision:snapshot.ledgerRevision,asOf:snapshot.asOf,mode:'overdue',fingerprint:'a'.repeat(64),previewToken:'b'.repeat(64),statement:{blockId:1,unitId:10,asOf:snapshot.asOf,sha256:createHash('sha256').update(bytes).digest('hex')}}}};
 await db.exec('reset role;set role service_role');
 await db.query("select queue_bulk_reminder_dispatches($1,'owner@example.invalid',$2,$3)",[JSON.stringify([{idempotency_key:key,block_id:1,unit_id:10,operation_id:envelope.operationId,kind:envelope.kind,recipient:envelope.to,envelope,scheduled_at:snapshot.generatedAt}]),snapshot.ledgerRevision,snapshot.asOf]);
 await db.query("select * from claim_bulk_reminder_dispatches(now()+interval '1 second',1)");
 await user('owner');
 const mixed=()=>db.query('select approve_block_statement(1,$1,$2,2,true)',[JSON.stringify([{id:incoming,unit_id:10}]),JSON.stringify([{id:outgoing103,invoiceId:'i3'}])]);
 await assert.rejects(mixed(),/being submitted/);
 assert.equal(await scalar('select count(*)::int n from supplier_settlements'),2);
 assert.equal(await scalar("select count(*)::int n from bank_contractor_reconciliations"),2);
 assert.equal((await db.query('select status from bank_statement_rows where id=$1',[incoming])).rows[0].status,'Pending');
 assert.equal((await db.query('select payment_status from work_orders where id=103')).rows[0].payment_status,'Approved');
 console.log('PASS 3/6: active unit reminder rolls back both supplier settlement and resident payment in a mixed approval.');
 // Staff document upload during active reminder does not alter ledger/revisions/payment state.
 const docId='11111111-1111-4111-8111-111111111111',path='103/'+docId+'/invoice.pdf';
 await db.query('insert into storage.objects values($1,$2,$3,$4)',['staff-work-order-documents',path,'00000000-0000-0000-0000-000000000001',JSON.stringify({mimetype:'application/pdf',size:10})]);
 await db.query("insert into staff_work_order_documents(id,work_order_id,contractor_id,document_type,storage_path,original_name) values($1,103,9,'invoice',$2,'synthetic.pdf')",[docId,path]);
 assert.equal((await db.query('select read_bulk_reminder_snapshot(1) s')).rows[0].s.ledgerRevision,snapshot.ledgerRevision);
 assert.equal((await db.query('select payment_status from work_orders where id=103')).rows[0].payment_status,'Approved');
 await user('contractor');assert.equal(await scalar('select count(*)::int n from staff_work_order_documents'),1);await assert.rejects(db.query("select approve_block_statement(1,'[]','[]',2,true)"),e=>e.code==='42501');
 console.log('PASS 4/6: staff document is independently stored/read by assigned contractor without ledger revision, payment change or financial approval authority.');
 await db.exec('reset role;set role service_role');await db.query("update management_dispatches set claimed_at=clock_timestamp()-interval '3 minutes' where idempotency_key=$1",[key]);
 await user('owner');await mixed();
 assert.equal(await scalar('select count(*)::int n from supplier_settlements'),3);
 assert.equal((await db.query('select status,envelope from management_dispatches where idempotency_key=$1',[key])).rows[0].status,'Uncertain');
 assert.deepEqual((await db.query('select envelope from management_dispatches where idempotency_key=$1',[key])).rows[0].envelope,envelope);
 assert.equal((await db.query('select status from bank_statement_rows where id=$1',[incoming])).rows[0].status,'Posted');
 assert.equal((await db.query('select payment_status from work_orders where id=103')).rows[0].payment_status,'Paid');
 const revisionAfter=(await db.query('select read_bulk_reminder_snapshot(1) s')).rows[0].s.ledgerRevision;assert.ok(Number(revisionAfter)>Number(snapshot.ledgerRevision));
 console.log('PASS 5/6: expired reminder lease becomes Uncertain; mixed approval commits, advances ledger revision and preserves exact historical attachment bytes.');
 await mixed();assert.equal(await scalar('select count(*)::int n from supplier_settlements'),3);assert.equal((await db.query('select read_bulk_reminder_snapshot(1) s')).rows[0].s.ledgerRevision,revisionAfter);
 console.log('PASS 6/6: exact mixed replay produces no additional settlement, resident posting or reminder revision.');
 console.log('PASS: 6 integrated synthetic PostgreSQL checks. No hosted database, real file upload, provider call or deployment.');
}finally{await db.close();}
