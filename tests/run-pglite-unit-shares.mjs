/** LOCAL disposable PostgreSQL only. No hosted access or database URLs.
 * PGLITE_MODULE=/tmp/london-db-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-unit-shares.mjs
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.env.PGLITE_MODULE)throw new Error('Set PGLITE_MODULE to the official installed PGlite module path.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
let checks=0;
async function scalar(sql){return Object.values((await db.query(sql)).rows[0])[0];}
async function actor(email){await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email})]);}
async function upload(rows,block=1){return db.query('select public.import_block_residents_with_shares($1,$2::jsonb) as count',[block,JSON.stringify(rows)]);}
async function snapshot(){return JSON.stringify((await db.query("select (select jsonb_agg(u order by id) from public.units u) units,(select jsonb_agg(r order by id) from public.residents r) residents")).rows);}
async function rejects(rows,pattern,block=1){const before=await snapshot();await assert.rejects(upload(rows,block),pattern);assert.equal(await snapshot(),before,'Rejected import must roll back all table writes');checks++;}
const row=(unit,share,extra={})=>({unit_number:unit,service_charge_percentage:share,...extra});
try{
 await db.exec(`
 create role anon nologin; create role authenticated nologin;
 create schema auth;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated; grant execute on function auth.jwt() to authenticated;
 create table public.portal_members(email text primary key,role text,portfolio_manager text);
 insert into public.portal_members values('owner@test.invalid','owner',null),('admin@test.invalid','admin',null),('manager@test.invalid','manager','London'),('other@test.invalid','manager','Other'),('resident@test.invalid','resident',null);
 create table public.blocks(id bigint primary key,manager text);
 insert into public.blocks values(1,'London'),(2,'Other');
 create table public.units(id bigint generated always as identity primary key,block_id bigint references public.blocks(id),unit_number text not null,payment_reference text,unique(block_id,unit_number));
 create unique index unit_payment_ref on public.units(block_id,upper(regexp_replace(payment_reference,'\\s','','g'))) where payment_reference is not null;
 create table public.residents(id bigint generated always as identity primary key,unit_id bigint references public.units(id),block_id bigint references public.blocks(id),full_name text,email text,phone text,archived_at timestamptz);
 create unique index residents_active_unit_email_idx on public.residents(unit_id,email) where archived_at is null;
 insert into public.units(block_id,unit_number,payment_reference) values(1,'Flat 1','KEEP-1'),(2,'Flat 1','OTHER-1');
 insert into public.residents(unit_id,block_id,full_name,email,archived_at) values(1,1,'Archived','archived@test.invalid',now());
 create table public.reference_fixture(unit_id bigint references public.units(id),resident_id bigint references public.residents(id));
 insert into public.reference_fixture values(1,1);
 grant select on public.blocks,public.portal_members to authenticated;
 grant select,insert,update on public.units,public.residents to authenticated;
 grant usage,select on all sequences in schema public to authenticated;
 alter table public.units enable row level security; alter table public.residents enable row level security;
 create policy scoped_units on public.units for all to authenticated
 using(exists(select 1 from public.portal_members m join public.blocks b on b.id=units.block_id where m.email=auth.jwt()->>'email' and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))))
 with check(exists(select 1 from public.portal_members m join public.blocks b on b.id=units.block_id where m.email=auth.jwt()->>'email' and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
 create policy scoped_residents on public.residents for all to authenticated
 using(exists(select 1 from public.portal_members m join public.blocks b on b.id=residents.block_id where m.email=auth.jwt()->>'email' and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))))
 with check(exists(select 1 from public.portal_members m join public.blocks b on b.id=residents.block_id where m.email=auth.jwt()->>'email' and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
 `);
 await db.exec(await readFile('docs/unit-apportionments-proposal.sql','utf8')); checks++;
 assert.equal(await scalar('select count(*)::int from public.units where service_charge_percentage is null'),2);checks++;
 await db.exec('set role authenticated');await actor('manager@test.invalid');
 const joint=[row('Flat 1','12.500',{resident_name:'A',resident_email:'a@test.invalid'}),row(' flat 1 ','12.5',{resident_name:'B',resident_email:'b@test.invalid'})];
 await upload(joint);const first=await snapshot();await upload(joint);assert.equal(await snapshot(),first);checks++;
 assert.equal(await scalar('select count(*)::int from units'),1);
 assert.equal(Number(await scalar('select service_charge_percentage from units')),12.5);checks++;
 await upload([row('Flat 1','',{payment_reference:''}),{unit_number:'Flat 1'}]);assert.equal(Number(await scalar('select service_charge_percentage from units')),12.5);assert.equal(await scalar('select payment_reference from units'),'KEEP-1');checks++;
 await upload([row('Flat 1','0')]);assert.equal(Number(await scalar('select service_charge_percentage from units')),0);await upload([row('Flat 1','100')]);checks++;
 await rejects([row('Flat 1','10',{payment_reference:'CHANGED'}),row('Flat 1','11')],/Conflicting service-charge/);
 await rejects([row('New unit','5'),row('Flat 1','5',{resident_email:'bad@test.invalid'})],/Resident name required/);
 for(const value of ['-1','100.000000000001','101','NaN','1e1','1.1234567890123','1%','Infinity'])await rejects([row('Flat 1',value)],/percentage/);
 await rejects([row('Flat 1','5',{payment_reference:'ONE'}),row('flat 1','5',{payment_reference:'TWO'})],/Conflicting payment references/);
 await rejects([row('New A','5',{unit_code:'source-code'}),row('New B','5',{unit_code:'SOURCE-CODE'})],/Unit code has conflicting names/);
 await rejects([{unit_code:'1',service_charge_percentage:'5'}],/Unknown unit code/);
 await upload([row('Flat 2','8')]);await rejects([row('Flat 1','5',{unit_code:'Flat 2'})],/Ambiguous or conflicting/);
 await upload([row('An alternative name','20',{unit_code:'Flat 1'})]);assert.equal(Number(await scalar("select service_charge_percentage from units where unit_number='Flat 1'")),20);assert.equal(await scalar("select count(*)::int from units where unit_number='An alternative name'"),0);checks++;
 await upload([row('New shared label','7'),row('Alias label','7',{unit_code:'new shared label'})]);
 assert.equal(await scalar("select count(*)::int from units where unit_number in ('New shared label','Alias label')"),1);checks++;
 await rejects([row('Another new label','7'),row('Another alias','8',{unit_code:'Another new label'})],/Conflicting service-charge/);
 await db.exec("insert into units(block_id,unit_number) values(1,'FLAT 2')");
 await rejects([row('Flat 2','8')],/Ambiguous or conflicting/);
 await upload([row('Flat 1','20',{resident_name:'Returning',resident_email:'archived@test.invalid'})]);
 assert.equal(await scalar("select count(*)::int from residents where email='archived@test.invalid' and archived_at is null"),1);
 assert.equal(await scalar("select count(*)::int from residents where id=1 and archived_at is not null"),1);checks++;
 await rejects([row('New in other block','5')],/Assigned portfolio access required/,2);
 await actor('resident@test.invalid');await rejects([row('Flat 1','5')],/Manager access required/);
 await actor('other@test.invalid');await rejects([row('Flat 1','5')],/Assigned portfolio access required/);
 // Deliberately retain permissive deployed-style blank equality in table RLS.
 // Verify the RPC itself rejects absent portfolio assignments, not just RLS.
 await db.exec('reset role');
 const blankAssignments=['',null,'   ','\t\n'];
 for(let i=0;i<blankAssignments.length;i++){
  await db.query('insert into public.portal_members(email,role,portfolio_manager) values($1,$2,$3)',[`blank${i}@test.invalid`,'manager',blankAssignments[i]]);
  await db.query('insert into public.blocks(id,manager) values($1,$2)',[10+i,blankAssignments[i]]);
 }
 await db.exec('set role authenticated');
 for(let i=0;i<blankAssignments.length;i++){
  await actor(`blank${i}@test.invalid`);
  await rejects([row('Must not be created','100')],/Assigned portfolio access required/,10+i);
 }
 // Empty equality really is permitted by this fixture's existing table policy.
 await actor('blank0@test.invalid');
 await db.exec("insert into units(block_id,unit_number) values(10,'Direct-policy-risk')");
 assert.equal(await scalar("select count(*)::int from units where block_id=10"),1);checks++;
 for(const role of ['owner','admin']){
  await actor(role+'@test.invalid');await upload([row('Owner-admin allowed','100')],10);checks++;
 }
 for(const role of ['owner','admin']){await actor(role+'@test.invalid');await upload([row('Flat 1','20')]);checks++;}
 await db.exec('reset role');
 assert.equal(await scalar("select payment_reference from units where block_id=2"),'OTHER-1');assert.equal(await scalar("select service_charge_percentage from units where block_id=2"),null);assert.equal(await scalar('select resident_id::int from reference_fixture'),1);checks++;
 await assert.rejects(db.exec('update units set service_charge_percentage=101 where id=1'),/units_service_charge_percentage_range/);checks++;
 assert.equal(await scalar("select prosecdef from pg_proc where proname='import_block_residents_with_shares'"),false);
 assert.equal(await scalar("select has_function_privilege('anon','public.import_block_residents_with_shares(bigint,jsonb)','execute')"),false);checks++;
 console.log('PASS: '+checks+' disposable PostgreSQL unit-share checks. SQL applies, atomicity, preservation, identifiers, archives, and synthetic RLS roles verified.');
}finally{await db.close();}
