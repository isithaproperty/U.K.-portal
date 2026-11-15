/** Synthetic disposable PostgreSQL only; no network or production records. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create table portal_members(email text primary key,role text,portfolio_manager text);
 create table blocks(id bigint primary key,manager text);
 create table residents(id bigint primary key,unit_id bigint,block_id bigint references blocks,full_name text,email text,phone text,created_at timestamptz default now(),archived_at timestamptz);
 create table ledger(id bigint primary key,resident_id bigint references residents,amount bigint);insert into blocks values(1,'London'),(2,'Other');
 insert into portal_members values('owner@test.invalid','owner',null),('admin@test.invalid','admin',null),('manager@test.invalid','manager','London'),('other@test.invalid','manager','Other'),('blank@test.invalid','manager','  '),('contractor@test.invalid','contractor',null);
 insert into residents(id,unit_id,block_id,full_name,email,phone) values(1,11,1,'Alice','old@test.invalid','123'),(2,22,2,'Bob','bob@test.invalid','456'),(3,12,1,'Carol','carol@test.invalid',null);
 insert into ledger values(1,1,12345);
 alter table residents enable row level security;
 create policy residents_read on residents for select to authenticated using(email=auth.jwt()->>'email' or exists(select 1 from portal_members m join blocks b on b.id=residents.block_id where m.email=auth.jwt()->>'email' and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));
 create policy residents_update on residents for update to authenticated using(exists(select 1 from portal_members m join blocks b on b.id=residents.block_id where m.email=auth.jwt()->>'email' and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager)))) with check(exists(select 1 from portal_members m join blocks b on b.id=residents.block_id where m.email=auth.jwt()->>'email' and (m.role in ('owner','admin') or (m.role='manager' and m.portfolio_manager=b.manager))));`);
 await db.exec(await readFile('docs/proposed-resident-contact-edit.sql','utf8'));
 const user=async(email,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email,sub:'00000000-0000-0000-0000-000000000001'})]);await db.exec(`set role ${role}`);};
 const edit=async(version=1,name='Alice Updated',email='contact@test.invalid',resident=1,block=1)=> (await db.query('select update_resident_contact($1,$2,$3,$4,$5,$6) as result',[block,resident,version,name,email,'789'])).rows[0].result;
 const deny=async(fn,code)=>assert.rejects(fn,error=>error.code===code);
 await user('manager@test.invalid');let result=await edit();assert.equal(result.resident.contact_version,2);assert.equal(result.resident.email,'old@test.invalid');assert.equal(result.resident.unit_id,11);assert.equal(result.changed,true);
 assert.equal((await edit(2)).changed,false);assert.equal((await db.query('select * from resident_contact_history')).rows.length,1);
 await deny(()=>edit(1),'40001');await deny(()=>edit(2,'Wrong','x@test.invalid',2,2),'42501');
 await deny(()=>edit(2,'\u00a0\u2000'),'P0001');await deny(()=>edit(2,'Alice','bad email@test.invalid'),'23514');await deny(()=>edit(2,'Alice','\tvalid@test.invalid'),'P0001');
 for(const email of ['old@test.invalid','contact@test.invalid','contractor@test.invalid','blank@test.invalid','other@test.invalid']){await user(email);await deny(()=>edit(2),'42501');assert.equal((await db.query('select * from resident_contact_history where resident_id=1')).rows.length,0);}
 await user('old@test.invalid');assert.equal((await db.query('select * from residents')).rows.length,1);await user('contact@test.invalid');assert.equal((await db.query('select * from residents')).rows.length,0);
 await user('admin@test.invalid');result=await edit(2,'Admin Update');assert.equal(result.resident.contact_version,3);
 await user('owner@test.invalid');await edit(1,'Carol Updated','contact@test.invalid',3);assert.equal((await db.query('select * from residents')).rows.length,3);
 await db.exec("update residents set archived_at=now() where id=1");await deny(()=>edit(4),'P0001');assert.equal((await db.query('select version from resident_contact_history where resident_id=1 order by version')).rows.length,3);
 for(const statement of ['delete from resident_contact_history','update resident_contact_history set actor_role=\'fake\'','insert into resident_contact_history default values'])await deny(()=>db.exec(statement),'42501');
 await user('service@test.invalid','service_role');await deny(()=>edit(4),'42501');await deny(()=>db.exec('delete from resident_contact_history'),'42501');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role'})]);await db.exec("update residents set phone='legacy service update' where id=3");
 await user('none@test.invalid','anon');await deny(()=>edit(1),'42501');await deny(()=>db.exec('select * from resident_contact_history'),'42501');
 await db.exec('reset role');assert.deepEqual((await db.query('select * from ledger')).rows,[{id:1,resident_id:1,amount:12345}]);assert.equal((await db.query('select email from residents where id=1')).rows[0].email,'old@test.invalid');assert.equal((await db.query('select count(*)::int as n from resident_contact_history where resident_id=3')).rows[0].n,2);
 assert.deepEqual((await db.query("select actor_id,actor_email,actor_role from resident_contact_history where resident_id=3 order by version desc limit 1")).rows,[{actor_id:null,actor_email:null,actor_role:'service_role'}]);
 // Failed audit insert aborts the original resident update atomically.
 await db.exec("create function private.reject_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;create trigger reject_audit before insert on resident_contact_history for each row execute function private.reject_audit();");
 await user('owner@test.invalid');await deny(()=>edit(3,'Must Roll Back','x@test.invalid',3),'P0001');assert.equal((await db.query('select full_name,contact_version from residents where id=3')).rows[0].full_name,'Carol Updated');
 console.log('PASS: migration under production-style default grants; scoped owner/admin/manager updates; direct RPC denial for tenant/contractor/foreign manager/anon/service; immutable audit; no-op and stale version; archive and legacy service audit; validation; duplicate contacts retain IDs; unchanged sign-in access and ledger; audit failure rollback.');
}finally{await db.close();}
