/** Isolated embedded PostgreSQL only. No hosted URLs or production reads/writes.
 * PGLITE_MODULE=/tmp/london-bulk-sql-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-bulk-reminders.mjs
 */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE to official local PGlite module.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
const exec=sql=>db.exec(sql),query=(sql,args=[])=>db.query(sql,args),read=async()=> (await query('select public.read_bulk_reminder_snapshot(1) value')).rows[0].value;
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
try{
 for(const path of ['tests/sql/management-review-bootstrap.sql','supabase/management_review.sql','tests/sql/management-financial-bootstrap.sql','supabase/service_charges.sql','tests/sql/management-dispatch-bootstrap.sql','supabase/management_dispatch.sql'])await exec(await readFile(path,'utf8'));
 await exec("alter table public.blocks add name text default 'Synthetic Court', add address text default 'Example road'; alter table public.units add payment_reference text default 'EXAMPLE'; insert into public.units(id,block_id,unit_number) values(11,1,'Flat 2'); grant all on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role;");
 await exec(await readFile('supabase/bulk_reminder_dispatch.sql','utf8'));
 await exec("set request.jwt.claims='{\"email\":\"manager@example.invalid\",\"sub\":\"11111111-1111-1111-1111-111111111111\"}';");
 await exec("insert into public.management_review_state(block_id,area,state,revision) values(1,'leaseholders','{\"contacts\":[{\"id\":\"owner1\",\"blockId\":1,\"unitId\":10,\"name\":\"Synthetic owner\",\"role\":\"Leaseholder\",\"emails\":[\"one@example.invalid\"],\"communications\":true,\"demands\":true},{\"id\":\"owner2\",\"blockId\":1,\"unitId\":11,\"name\":\"Synthetic other\",\"role\":\"Leaseholder\",\"emails\":[\"two@example.invalid\"],\"communications\":true,\"demands\":true}],\"consultations\":[]}',1); insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by) values(1,10,'Charge','Synthetic charge',10000,current_date-30,current_date-10,'charge-a','manager@example.invalid'),(1,11,'Charge','Synthetic charge',10000,current_date-30,current_date+7,'charge-b','manager@example.invalid');");
 await check('authenticated manager snapshot is scoped and no direct queue permissions',async()=>{
  await exec("set role authenticated; set request.jwt.claims='{\"email\":\"manager@example.invalid\",\"sub\":\"11111111-1111-1111-1111-111111111111\"}';");const s=await read();assert.equal(s.units.length,2);assert.equal(s.entries.length,2);assert.equal(typeof s.ledgerRevision,'string');assert.deepEqual(s.protectedRecipients,[]);
  await assert.rejects(query('select public.read_bulk_reminder_snapshot(2)'),/Manager building access/);
  assert.equal((await query("select has_function_privilege('authenticated','public.queue_bulk_reminder_dispatches(jsonb,text,text,date)','execute') ok")).rows[0].ok,false);
  assert.equal((await query("select has_table_privilege('authenticated','public.bulk_reminder_revisions','UPDATE') ok")).rows[0].ok,false);
  await exec("reset role; set role service_role;");
 });
 const pdfBytes=Buffer.from('%PDF-1.4\nSynthetic isolated SQL attachment fixture\n%%EOF\n');
 const pdfAttachment={fileName:'account-statement.pdf',mediaType:'application/pdf',encoding:'base64',content:pdfBytes.toString('base64')};
 const pdfSha256=createHash('sha256').update(pdfBytes).digest('hex');
 const make=(s,{id='mgmt-v1-bulk-example-key-0001',unit=10,to='one@example.invalid',kind='Overdue account reminder',mode='overdue',operation='bulk-reminder:'+s.asOf}={})=>({idempotency_key:id,block_id:1,unit_id:unit,operation_id:operation,kind,recipient:to,scheduled_at:s.generatedAt,envelope:{idempotencyKey:id,operationId:operation,kind,blockId:1,unitId:unit,to,subject:'Synthetic account reminder',body:'Recorded balance',attachments:[pdfAttachment],sourceEvidence:{contactRevision:s.contactRevision,bulkReminder:{ledgerRevision:s.ledgerRevision,asOf:s.asOf,mode,statement:{blockId:1,unitId:unit,asOf:s.asOf,sha256:pdfSha256},fingerprint:'a'.repeat(64),previewToken:'b'.repeat(64)}}}});
 const queue=(s,rows)=>query('select public.queue_bulk_reminder_dispatches($1::jsonb,$2,$3,$4::date) n',[JSON.stringify(rows),'manager@example.invalid',s.ledgerRevision,s.asOf]);
 await check('PDF attachment is mandatory and exact unit/date/digest evidence is required at queue',async()=>{
  const s=await read();
  const patches=[r=>r.envelope.attachments=[],r=>r.envelope.attachments=[pdfAttachment,pdfAttachment],r=>r.envelope.attachments=[{...pdfAttachment,mediaType:'text/plain'}],r=>r.envelope.attachments=[{...pdfAttachment,encoding:'utf8'}],r=>r.envelope.attachments=[{...pdfAttachment,fileName:'../other.pdf'}],r=>r.envelope.attachments=[{...pdfAttachment,content:'!!!!'}],r=>r.envelope.attachments=[{...pdfAttachment,content:Buffer.from('not a pdf').toString('base64')}],r=>r.envelope.attachments=[{...pdfAttachment,content:'A'.repeat(3000004)}],r=>r.envelope.sourceEvidence.bulkReminder.statement.unitId=11,r=>r.envelope.sourceEvidence.bulkReminder.statement.blockId=2,r=>r.envelope.sourceEvidence.bulkReminder.statement.asOf='2000-01-01',r=>r.envelope.sourceEvidence.bulkReminder.statement.sha256='0'.repeat(64),r=>delete r.envelope.sourceEvidence.bulkReminder.statement];
  for(const patch of patches){const row=make(s);patch(row);await assert.rejects(queue(s,[row]),/snapshot|account changed/);}
  assert.equal((await query('select count(*)::int n from public.management_dispatches')).rows[0].n,0);
 });
 await check('queue is atomic, validates due/recipient, exact retry idempotent',async()=>{
  const s=await read();await assert.rejects(queue(s,[make(s),make(s,{id:'mgmt-v1-bulk-example-key-0002',unit:11,to:'two@example.invalid'})]),/snapshot|account changed/);assert.equal((await query('select count(*)::int n from public.management_dispatches')).rows[0].n,0);
  await queue(s,[make(s)]);await queue(s,[make(s)]);assert.equal((await query('select count(*)::int n from public.management_dispatches')).rows[0].n,1);
  await assert.rejects(queue(s,[make(s,{id:'mgmt-v1-bulk-example-key-duplicate',kind:'Friendly balance notice',mode:'outstanding'})]),/duplicate key/);
 });
 await check('legacy claim excludes bulk, dedicated claim plus pre-submit verify',async()=>{
  assert.equal((await query('select * from public.claim_management_dispatches(now()+interval \'1 second\',1)')).rows.length,0);
  const claim=(await query("select * from public.claim_bulk_reminder_dispatches(now()+interval '1 second',1)")).rows[0];assert.equal(claim.status,'Sending');
  assert.equal((await query('select public.verify_bulk_reminder_submission($1,$2::uuid) ok',[claim.idempotency_key,claim.claim_token])).rows[0].ok,true);
  await assert.rejects(query("update public.management_dispatches set envelope=jsonb_set(envelope,'{attachments,0,content}',to_jsonb('JVBERi0xLjQKVEFNUEVSRUQ='::text)) where idempotency_key=$1",[claim.idempotency_key]),/immutable/);
  // Verify's shared row-current predicate rejects corruption without mutating approved history.
  const malformed={...claim,envelope:{...claim.envelope,attachments:[{...pdfAttachment,content:'JVBERi0xLjQKVEFNUEVSRUQ='}]}};
  assert.equal((await query('select public.bulk_reminder_row_current(jsonb_populate_record(null::public.management_dispatches,$1::jsonb),$2::bigint,$3::date) ok',[JSON.stringify(malformed),(await read()).ledgerRevision,(await read()).asOf])).rows[0].ok,false);

  assert.equal((await query("select public.verify_bulk_reminder_submission($1,'00000000-0000-0000-0000-000000000000') ok",[claim.idempotency_key])).rows[0].ok,false);
 });
 await check('active send blocks payment for same unit but permits other unit payment',async()=>{
  await assert.rejects(exec("insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,reference,created_by) values(1,10,'Payment','Payment',1000,current_date,'blocked','manager@example.invalid')"),/being submitted/);
  await exec("insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,reference,created_by) values(1,11,'Payment','Payment',1000,current_date,'allowed','manager@example.invalid')");
 });
 await check('lease nearing expiry refuses transport; stale claim becomes uncertain before payment/contact edit',async()=>{
  await exec("update public.management_dispatches set claimed_at=clock_timestamp()-interval '80 seconds' where status='Sending'");const r=(await query('select * from public.management_dispatches')).rows[0];assert.equal((await query('select public.verify_bulk_reminder_submission($1,$2::uuid) ok',[r.idempotency_key,r.claim_token])).rows[0].ok,false);
  await exec("update public.management_dispatches set claimed_at=clock_timestamp()-interval '3 minutes' where status='Sending'; update public.management_review_state set revision=revision+1 where block_id=1 and area='leaseholders'");
  assert.equal((await query('select status from public.management_dispatches')).rows[0].status,'Uncertain');
  await exec("insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,reference,created_by) values(1,10,'Payment','Payment',10000,current_date,'after-expiry','manager@example.invalid')");
  assert.equal((await query("select * from public.claim_bulk_reminder_dispatches(now()+interval '1 day',1)")).rows.length,0);
 });
 await check('newly paid account rejected and changed revision/date rejects queue',async()=>{
  const s=await read();await assert.rejects(queue(s,[make(s,{id:'mgmt-v1-bulk-example-paid-key'})]),/account changed/);
  const before=s.ledgerRevision;await exec("update public.units set payment_reference='CHANGED' where id=11");await assert.rejects(queue(s,[make(s,{id:'mgmt-v1-bulk-stale-key-00001',unit:11,to:'two@example.invalid',kind:'Friendly balance notice',mode:'outstanding'})]),/Ledger/);
  const fresh=await read();assert.notEqual(fresh.ledgerRevision,before);await assert.rejects(queue({...fresh,asOf:'2000-01-01'},[make(fresh)]),/statement day/);
 });
 await check('queued account changed after approval fails claim without submission',async()=>{
  const s=await read();await queue(s,[make(s,{id:'mgmt-v1-bulk-future-key-00001',unit:11,to:'two@example.invalid',kind:'Friendly balance notice',mode:'outstanding'})]);await exec("update public.units set payment_reference='CHANGED-AGAIN' where id=11");assert.equal((await query("select * from public.claim_bulk_reminder_dispatches(now()+interval '1 second',1)")).rows.length,0);assert.equal((await query("select status from public.management_dispatches where unit_id=11")).rows[0].status,'Failed');
 });
 await check('fresh reviewed replacement for unsent failure works; accepted or uncertain still blocks replacement',async()=>{
  const s=await read(),replacement=make(s,{id:'mgmt-v1-bulk-reviewed-replacement',unit:11,to:'two@example.invalid',kind:'Friendly balance notice',mode:'outstanding',operation:'bulk-reminder:'+s.asOf+':fresh-source'});
  await queue(s,[replacement]);assert.equal((await query("select count(*)::int n from public.management_dispatches where unit_id=11")).rows[0].n,2);
  await assert.rejects(queue(s,[make(s,{...{unit:11,to:'two@example.invalid',kind:'Friendly balance notice',mode:'outstanding'},id:'mgmt-v1-bulk-second-replacement',operation:'bulk-reminder:'+s.asOf+':another-content'})]),/duplicate key/);
  const claimed=(await query("select * from public.claim_bulk_reminder_dispatches(now()+interval '1 second',1)")).rows[0];assert.equal(claimed.idempotency_key,replacement.idempotency_key);
  await query("select public.finish_management_dispatch($1,$2::uuid,'Sent','synthetic-provider','Synthetic acceptance evidence')",[claimed.idempotency_key,claimed.claim_token]);
  await assert.rejects(queue(s,[make(s,{id:'mgmt-v1-bulk-after-sent-attempt',unit:11,to:'two@example.invalid',kind:'Friendly balance notice',mode:'outstanding',operation:'bulk-reminder:'+s.asOf+':third-content'})]),/duplicate key/);
  await queue(s,[replacement]);assert.equal((await query("select attempt_count from public.management_dispatches where idempotency_key=$1",[replacement.idempotency_key])).rows[0].attempt_count,1);
 });
 await check('explicit recovery is service-only and works independently of delivery activation',async()=>{
  assert.equal((await query('select public.recover_bulk_reminder_claims(1) ok')).rows[0].ok,0);
  assert.equal((await query("select has_function_privilege('authenticated','public.recover_bulk_reminder_claims(bigint)','execute') ok")).rows[0].ok,false);
  assert.equal((await query("select has_function_privilege('anon','public.recover_bulk_reminder_claims(bigint)','execute') ok")).rows[0].ok,false);
  // Revise only the synthetic already-Uncertain unit-10 claim to model a crashed worker.
  await exec("update public.management_dispatches set status='Sending',claimed_at=clock_timestamp()-interval '3 minutes' where unit_id=10 and status='Uncertain'");
  assert.equal((await query('select public.recover_bulk_reminder_claims(1) n')).rows[0].n,1);
  assert.equal((await query('select status from public.management_dispatches where unit_id=10')).rows[0].status,'Uncertain');
  assert.equal((await query("select status from public.management_dispatches where idempotency_key='mgmt-v1-bulk-reviewed-replacement'")).rows[0].status,'Sent');
 });
 await check('snapshot protects accepted and uncertain recipients but excludes definitively unsent failures',async()=>{
  const s=await read();assert.deepEqual(s.protectedRecipients,[{unitId:10,recipient:'one@example.invalid',status:'Uncertain',idempotencyKey:'mgmt-v1-bulk-example-key-0001'},{unitId:11,recipient:'two@example.invalid',status:'Sent',idempotencyKey:'mgmt-v1-bulk-reviewed-replacement'}]);
  assert.ok(!s.protectedRecipients.some(r=>r.idempotencyKey==='mgmt-v1-bulk-future-key-00001'));
 });
 await check('claim rejects stored PDF corruption before transport',async()=>{
  await exec("insert into public.units(id,block_id,unit_number) values(13,1,'Flat 3'); insert into public.service_charge_entries(block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference,created_by) values(1,13,'Charge','Synthetic charge',10000,current_date-30,current_date+7,'charge-c','manager@example.invalid'); update public.management_review_state set revision=revision+1,state=jsonb_set(state,'{contacts}',state->'contacts'||jsonb_build_array(jsonb_build_object('id','owner3','blockId',1,'unitId',13,'name','Synthetic third','role','Leaseholder','emails',jsonb_build_array('three@example.invalid'),'communications',true,'demands',true))) where block_id=1 and area='leaseholders'");
  const s=await read();
  const row=make(s,{id:'mgmt-v1-bulk-pdf-corrupted-claim',unit:13,to:'three@example.invalid',kind:'Friendly balance notice',mode:'outstanding',operation:'bulk-reminder:'+s.asOf+':pdf-check'});
  // Seed an isolated malformed legacy row via the old generic RPC to prove the new
  // claim path fails closed even if a row did not pass the dedicated bulk queue.
  row.envelope.attachments=[];await query('select public.queue_management_dispatches($1::jsonb,$2)',[JSON.stringify([row]),'manager@example.invalid']);
  assert.equal((await query("select * from public.claim_bulk_reminder_dispatches(now()+interval '1 second',1)")).rows.length,0);
  assert.equal((await query('select status from public.management_dispatches where idempotency_key=$1',[row.idempotency_key])).rows[0].status,'Failed');
 });
 await check('contact deletion advances revision and no anonymous or resident snapshot access',async()=>{
  const before=await read();await exec("delete from public.management_review_state where block_id=1 and area='leaseholders'");const after=await read();assert.notEqual(after.ledgerRevision,before.ledgerRevision);assert.deepEqual(after.contactState,{contacts:[],consultations:[]});
  await exec("reset role; set role authenticated; set request.jwt.claims='{\"email\":\"tenant@example.invalid\",\"sub\":\"11111111-1111-1111-1111-111111111111\"}'");await assert.rejects(read(),/Manager building access/);
  assert.equal((await query("select has_function_privilege('anon','public.read_bulk_reminder_snapshot(bigint)','execute') ok")).rows[0].ok,false);
  await exec('reset role; set role service_role');
 });
 console.log(`PASS: ${passed} isolated PostgreSQL bulk reminder checks. No external database accessed.`);
}finally{await db.close();}
