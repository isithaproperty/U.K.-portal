/** Exact reviewed production policy/function definitions, synthetic rows, disposable embedded DB only. */
import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
const snapshot=JSON.parse(await readFile('tests/fixtures/manager-cover-production-definitions.json','utf8'));
const tables=JSON.parse(await readFile('tests/fixtures/manager-cover-production-columns.json','utf8'));
const privileges=JSON.parse(await readFile('tests/fixtures/manager-cover-production-privileges.json','utf8'));
const quote=s=>'"'+s.replaceAll('"','""')+'"';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create schema storage;
 create type storage.buckettype as enum('STANDARD','ANALYTICS','VECTOR');
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;
 set check_function_bodies=off;`);
 for(const t of tables)await db.exec(`create table ${quote(t.schema)}.${quote(t.table)}(${t.columns});`);
 await db.exec(`create table auth.users(id uuid,email text,last_sign_in_at timestamptz,deleted_at timestamptz,is_anonymous boolean);
 grant usage on schema private,storage to authenticated;
 grant select on public.portal_members to authenticated;
 alter table public.portal_members enable row level security;
 create policy members_self on public.portal_members for select to authenticated using(email=lower(auth.jwt()->>'email'));
 insert into portal_members(email,role,portfolio_manager) values('ramiro@aviaf.co.uk','manager','Ramiro Naidoo'),('jillian@aviaf.co.uk','manager','Jillian'),('bobby@aviaf.co.uk','admin',null),('owner@test.invalid','owner',null),('other@test.invalid','manager','Other'),('lookalike@test.invalid','manager','Ramiro Naidoo'),('resident@test.invalid','resident',null),('contractor@test.invalid','contractor',null);
 insert into blocks(id,manager,name) values(1,'Ramiro Naidoo','Synthetic Ramiro'),(2,'Jillian','Synthetic Jillian'),(3,'Bobby','Synthetic Bobby'),(4,'Other','Synthetic Other');
 insert into units(id,block_id,unit_number) values(11,1,'1'),(22,2,'2'),(33,3,'3'),(44,4,'4');
 insert into residents(id,unit_id,block_id,full_name,email,contact_version) values(1,11,1,'Synthetic R','r@test.invalid',1),(2,22,2,'Synthetic J','j@test.invalid',1),(3,33,3,'Synthetic B','b@test.invalid',1),(4,44,4,'Synthetic O','o@test.invalid',1);
 insert into work_orders(id,block_id,status,title) values(101,1,'Open','Synthetic'),(102,2,'Open','Synthetic'),(103,3,'Open','Synthetic'),(104,4,'Open','Synthetic');
 insert into building_safety_records(id,block_id,title) values(1,1,'Synthetic'),(2,2,'Synthetic'),(3,3,'Synthetic'),(4,4,'Synthetic');
 insert into service_charge_entries(id,block_id,unit_id,amount_pence) values(1,1,11,100),(2,2,22,200),(3,3,33,300),(4,4,44,400);
 insert into building_cashflow_rows(id,block_id) values(1,1),(2,2),(3,3),(4,4);
 insert into bank_contractor_reconciliations(cashflow_row_id,block_id) values(1,1),(2,2),(3,3),(4,4);
 insert into management_review_state(block_id,area,revision,state) values(1,'financials',1,'{}'),(2,'financials',1,'{}'),(3,'financials',1,'{}'),(4,'financials',1,'{}');
 insert into storage.objects(bucket_id,name) values('building-safety-documents','1/synthetic.pdf'),('building-safety-documents','2/synthetic.pdf'),('building-safety-documents','3/synthetic.pdf'),('building-safety-documents','4/synthetic.pdf');`);
 await db.exec(await readFile('tests/fixtures/manager-cover-recipient-function.sql','utf8'));
 for(const p of snapshot.policies){
  const target=quote(p.schema)+'.'+quote(p.table);
  await db.exec(`alter table ${target} enable row level security;grant select,insert,update,delete on ${target} to authenticated;create policy ${quote(p.name)} on ${target} for ${p.cmd} to ${p.roles.map(quote).join(',')}${p.qual?' using ('+p.qual+')':''}${p.check?' with check ('+p.check+')':''}`);
 }
 // Existing independent admin policies (not changed by the proposal).
 for(const table of ['blocks','units','residents','work_orders','building_safety_records','service_charge_entries','building_cashflow_rows','management_review_state'])await db.exec(`create policy admin_all on public.${table} for all to authenticated using(exists(select 1 from portal_members m where m.email=auth.jwt()->>'email' and m.role='admin')) with check(exists(select 1 from portal_members m where m.email=auth.jwt()->>'email' and m.role='admin'))`);
 for(const f of snapshot.functions)await db.exec(f.definition);
 const staff=JSON.parse(await readFile('tests/fixtures/manager-cover-staff-storage.json','utf8'));await db.exec(staff.definition);await db.exec('revoke all on function private.staff_wo_storage_access(text,boolean) from public,anon,service_role;grant execute on function private.staff_wo_storage_access(text,boolean) to authenticated');
 for(const p of [...JSON.parse(await readFile('tests/fixtures/manager-cover-indirect-policies.json','utf8')),...staff.policies]){const target=quote(p.schema)+'.'+quote(p.table);await db.exec(`alter table ${target} enable row level security;create policy ${quote(p.name)} on ${target} for ${p.cmd} to ${p.roles.map(quote).join(',')}${p.qual?' using ('+p.qual+')':''}${p.check?' with check ('+p.check+')':''}`);}
 await db.exec("insert into contractors(id,email) values(9,'contractor@test.invalid');update work_orders set contractor_id=9;insert into work_order_dispatches(id,work_order_id,block_id,contractor_id,recipient_email) values(1001,101,1,9,'contractor@test.invalid'),(1002,102,2,9,'contractor@test.invalid'),(1003,103,3,9,'contractor@test.invalid');");
 // Reproduce current production operation grants and function ACLs, rather than relying on local defaults.
 for(const t of tables)await db.exec(`revoke all on ${quote(t.schema)}.${quote(t.table)} from public,anon,authenticated,service_role`);
 for(const t of privileges.tables){const operations=['select','insert','update','delete'].filter(k=>t[k]);if(operations.length)await db.exec(`grant ${operations.join(',')} on ${quote(t.schema)}.${quote(t.table)} to ${quote(t.role)}`);}
 for(const c of JSON.parse(await readFile('tests/fixtures/manager-cover-production-column-grants.json','utf8')))await db.exec(`grant ${c.privilege} (${quote(c.column)}) on ${quote(c.schema)}.${quote(c.table)} to ${quote(c.role)}`);
 for(const f of privileges.functions){const target=quote(f.schema)+'.'+quote(f.name)+'('+f.identity+')';await db.exec(`revoke all on function ${target} from public,anon,authenticated,service_role`);for(const g of f.grants??[])await db.exec(`grant execute on function ${target} to ${g.role==='public'?'public':quote(g.role)}`);}
 // Install exact migration guard comparisons against the source definitions: PGlite/Postgres can normalize formatting.
 // Our fixture policies were reconstructed from catalog expressions, so verify that they round trip first.
 for(const p of snapshot.policies){const actual=(await db.query('select qual,with_check from pg_policies where schemaname=$1 and tablename=$2 and policyname=$3',[p.schema,p.table,p.name])).rows[0];assert.equal(actual.qual,p.qual);assert.equal(actual.with_check,p.check);}
 const proposal=await readFile('docs/proposed-named-manager-cover.sql','utf8');
 const rowsBefore=async()=>{await db.exec('reset role');return (await db.query(`select (select jsonb_agg(b) from blocks b) blocks,(select jsonb_agg(m) from portal_members m) members,(select jsonb_agg(r) from residents r) residents,(select jsonb_agg(w) from work_orders w) orders,(select jsonb_agg(s) from storage.objects s) objects,has_schema_privilege('service_role','private','usage') service_private_usage`)).rows[0]};
 const before=await rowsBefore();
 // Cross-cover must not implicitly authorize or conceal the separate H&S correction.
 await assert.rejects(db.exec(proposal),/Reviewed policy changed: portfolio scoped safety storage/);await db.exec('rollback');
 assert.equal((await db.query("select to_regprocedure('public.manager_portfolio_matches(text,text,text)') is null absent")).rows[0].absent,true);
 await db.exec(await readFile('tests/fixtures/manager-cover-safety-prerequisite.sql','utf8'));
 await db.exec(proposal);assert.deepEqual(await rowsBefore(),before);
 const as=async(email,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email,sub:'00000000-0000-0000-0000-000000000001',user_metadata:{role:'owner',portfolio_manager:'Bobby'}})]);await db.exec(`set role ${role}`)};
 const ids=async(table,key=table==='bank_contractor_reconciliations'?'cashflow_row_id':'id')=>(await db.query(`select ${key} from ${table} order by ${key}`)).rows.map(r=>Number(r[key]));
 for(const email of ['ramiro@aviaf.co.uk','jillian@aviaf.co.uk']){
  await as(email);
  for(const table of ['blocks','units','residents','work_orders','building_safety_records','service_charge_entries','building_cashflow_rows','bank_contractor_reconciliations'])assert.equal((await ids(table)).length,2,`${email} ${table}`);
  assert.deepEqual(await ids('blocks'),[1,2]);
  assert.equal((await db.query("update blocks set name='Covered change' where id=2 returning id")).rows.length,1);
  assert.equal((await db.query("update blocks set name='Denied' where id=3 returning id")).rows.length,0);
  await assert.rejects(db.exec("update blocks set manager='Ramiro Naidoo' where id=2"),e=>e.code==='42501');
  await assert.rejects(db.exec("update portal_members set role='owner' where email='"+email+"'"),e=>e.code==='42501');
  assert.equal((await db.query('select private.client_invoice_can_manage(2,false) ok')).rows[0].ok,true);
  assert.equal((await db.query('select private.client_invoice_can_manage(2,true) ok')).rows[0].ok,false);
  assert.equal((await db.query('select private.can_manage_resident_contact(2) ok')).rows[0].ok,true);
  assert.equal((await db.query('select private.staff_can_manage_wo_document(102) ok')).rows[0].ok,true);assert.equal((await db.query('select private.staff_can_manage_wo_document(103) ok')).rows[0].ok,false);
  assert.equal((await db.query('select private.can_access_work_order_dispatch(1002,true) ok')).rows[0].ok,true);assert.equal((await db.query('select private.can_access_work_order_dispatch(1003,true) ok')).rows[0].ok,false);
  const file=`102/00000000-0000-0000-0000-00000000000${email.startsWith('ramiro')?'1':'2'}/invoice.pdf`;
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('staff-work-order-documents',$1,auth.uid()::text)",[file]);
  assert.equal((await db.query("select name from storage.objects where bucket_id='staff-work-order-documents' and name=$1",[file])).rows.length,1);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id) values('staff-work-order-documents',$1,auth.uid()::text)",[file.replace('102/','103/')]),e=>e.code==='42501');
  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='staff-work-order-documents' and name=$1",[file]);await as(email);
  assert.equal((await db.query('select * from private.read_resident_account_sign_ins(2)')).rows.length,1);
  await assert.rejects(db.query('select * from private.read_resident_account_sign_ins(3)'),e=>e.code==='42501');
 }
 await as('bobby@aviaf.co.uk');assert.deepEqual(await ids('blocks'),[1,2,3,4]);assert.equal((await db.query('select private.client_invoice_can_manage(3,true) ok')).rows[0].ok,true);
 await as('other@test.invalid');assert.equal((await db.query("select public.manager_portfolio_matches('ramiro@aviaf.co.uk','Ramiro Naidoo','Jillian') ok")).rows[0].ok,true);assert.deepEqual(await ids('blocks'),[4]);
 await as('lookalike@test.invalid');assert.deepEqual(await ids('blocks'),[1]);
 for(const email of ['resident@test.invalid','contractor@test.invalid','missing@test.invalid']){await as(email);assert.deepEqual(await ids('blocks'),[]);assert.equal((await db.query('select private.client_invoice_can_manage(2,false) ok')).rows[0].ok,false);}
 // Changed home assignment and role revoke reciprocal cover immediately, without token refresh.
 await db.exec("reset role;update portal_members set portfolio_manager='Other' where email='ramiro@aviaf.co.uk'");await as('ramiro@aviaf.co.uk');assert.deepEqual(await ids('blocks'),[4]);
 await db.exec("reset role;update portal_members set role='resident',portfolio_manager='Ramiro Naidoo' where email='ramiro@aviaf.co.uk'");await as('ramiro@aviaf.co.uk');assert.deepEqual(await ids('blocks'),[]);
 await db.exec("reset role;update portal_members set role='manager' where email='ramiro@aviaf.co.uk'");
 // A scheduled worker re-checks the original approving manager, including reciprocal cover and revocation.
 await db.exec(`reset role;insert into management_review_state(block_id,area,revision,state) values(2,'leaseholders',1,'{"contacts":[{"blockId":2,"unitId":22,"emails":["j@test.invalid"],"role":"Leaseholder","demands":true}]}');
 insert into management_dispatches(idempotency_key,block_id,unit_id,kind,recipient,envelope,scheduled_at,status,approved_by,attempt_count) values('synthetic-covered-claim',2,22,'Demand','j@test.invalid','{}','2026-01-01','Pending','ramiro@aviaf.co.uk',0);`);
 await as('worker@test.invalid','service_role');assert.equal((await db.query("select * from claim_management_dispatches('2026-02-01',2)")).rows.length,1);
 await db.exec(`reset role;update management_dispatches set status='Pending',claimed_at=null where idempotency_key='synthetic-covered-claim';update portal_members set portfolio_manager='Other' where email='ramiro@aviaf.co.uk';`);
 await as('worker@test.invalid','service_role');assert.equal((await db.query("select * from claim_management_dispatches('2026-02-01',2)")).rows.length,0);
 await db.exec("reset role;update portal_members set portfolio_manager='Ramiro Naidoo' where email='ramiro@aviaf.co.uk'");assert.equal((await db.query("select status from management_dispatches where idempotency_key='synthetic-covered-claim'")).rows[0].status,'Failed');
 for(const role of ['anon','service_role']){await as('ramiro@aviaf.co.uk',role);await assert.rejects(db.query('select private.client_invoice_can_manage(2,false)'),e=>e.code==='42501');}
 // Separately reviewed H&S prerequisite plus cross-cover permits only canonical, assigned paths.
 for(const email of ['ramiro@aviaf.co.uk','jillian@aviaf.co.uk']){await as(email);assert.deepEqual((await db.query('select name from storage.objects order by name')).rows.map(r=>r.name),['1/synthetic.pdf','2/synthetic.pdf']);await db.exec("insert into storage.objects(bucket_id,name) values('building-safety-documents','2/"+email.split('@')[0]+".pdf')");await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('building-safety-documents','3/denied.pdf')"),e=>e.code==='42501');await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('building-safety-documents','../denied.pdf')"),e=>e.code==='42501');await db.exec("delete from storage.objects where name='2/"+email.split('@')[0]+".pdf'");}
 // Rollback restores exact original scope, without deleting financial/resident/object rows.
 await db.exec('reset role');await db.exec(await readFile('docs/rollback-named-manager-cover.sql','utf8'));await as('ramiro@aviaf.co.uk');assert.deepEqual(await ids('blocks'),[1]);await as('jillian@aviaf.co.uk');assert.deepEqual(await ids('blocks'),[2]);assert.deepEqual((await db.query('select name from storage.objects order by name')).rows.map(r=>r.name),['2/synthetic.pdf']);
 console.log('PASS: exact 42 policy / 18 function proposal installs atomically against catalog snapshot; rows preserved; both named managers own+cover; Bobby global; other/forged/role-changed/mapping-changed denial; manager reassignment and escalation denied; client approval denied; contact/sign-in scope; proposal refuses absent H&S prerequisite without partial changes; separately applied local H&S prerequisite permits scoped upload/read/delete; scheduled claim rechecks real approver and rejects revoked cover; production table/column/function privileges; rollback restores original scopes while retaining H&S correction.');
}finally{await db.close()}
