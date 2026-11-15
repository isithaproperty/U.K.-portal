/** Disposable synthetic PostgreSQL; never connects to hosted databases. */
import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create table portal_members(email text primary key,role text,portfolio_manager text);create table blocks(id bigint primary key,manager text);
 create table residents(id bigint primary key,block_id bigint,email text,archived_at timestamptz);
 create table auth.users(id uuid primary key,email text,last_sign_in_at timestamptz,updated_at timestamptz,deleted_at timestamptz,is_anonymous boolean);
 create table auth.sessions(user_id uuid,refreshed_at timestamptz);revoke all on auth.users,auth.sessions from public,anon,authenticated,service_role;
 insert into blocks values(1,'London'),(2,'Other'),(3,'  ');
 insert into portal_members values('owner@test.invalid','owner',null),('admin@test.invalid','admin',null),('manager@test.invalid','manager','London'),('other@test.invalid','manager','Other'),('blank@test.invalid','manager','  '),('contractor@test.invalid','contractor',null);
 insert into residents values(1,1,'LOGIN@test.invalid',null),(2,1,'never@test.invalid',null),(3,1,'missing@test.invalid',null),(4,2,'other@test.invalid',null),(5,1,'ambiguous@test.invalid',null),(6,1,'deleted@test.invalid',null),(7,1,'anonymous@test.invalid',null),(8,1,'future@test.invalid',null),(9,1,'infinite@test.invalid',null),(10,1,'login@test.invalid','2026-01-01');
 insert into auth.users values('00000000-0000-0000-0000-000000000001','login@test.invalid','2026-01-01T12:00Z','2026-11-01',null,false),('00000000-0000-0000-0000-000000000002','never@test.invalid',null,'2026-11-01',null,false),('00000000-0000-0000-0000-000000000003','other@test.invalid','2026-01-02','2026-11-01',null,false),('00000000-0000-0000-0000-000000000004','ambiguous@test.invalid','2026-01-01','2026-11-01',null,false),('00000000-0000-0000-0000-000000000005','AMBIGUOUS@test.invalid','2026-02-01','2026-11-01',null,false),('00000000-0000-0000-0000-000000000006','deleted@test.invalid','2026-01-01','2026-11-01','2026-02-01',false),('00000000-0000-0000-0000-000000000007','anonymous@test.invalid','2026-01-01','2026-11-01',null,true),('00000000-0000-0000-0000-000000000008','future@test.invalid','2999-01-01','2026-11-01',null,false),('00000000-0000-0000-0000-000000000009','infinite@test.invalid','infinity','2026-11-01',null,false);
 insert into auth.sessions values('00000000-0000-0000-0000-000000000001','2026-11-01');`);
 const before=(await db.query('select * from auth.users order by id')).rows;
 await db.exec(await readFile('docs/proposed-resident-sign-ins.sql','utf8'));
 const user=async(email,role='authenticated',sub='00000000-0000-0000-0000-000000000099')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email,sub,role:'admin'})]);await db.exec(`set role ${role}`);};
 const read=async(block=1,name='public')=>(await db.query(`select * from ${name}.read_resident_account_sign_ins($1) order by resident_id`,[block])).rows;
 const denied=async(fn)=>assert.rejects(fn,error=>error.code==='42501');
 await user('manager@test.invalid');const rows=await read();assert.equal(rows.length,9);assert.deepEqual(Object.keys(rows[0]),['resident_id','last_sign_in_at','state']);assert.equal(rows[0].state,'signed_in');assert.equal(new Date(rows[0].last_sign_in_at).toISOString(),'2026-01-01T12:00:00.000Z');
 assert.equal(rows.find(r=>r.resident_id===2).state,'never_recorded');assert.equal(rows.find(r=>r.resident_id===3).state,'no_account');for(const id of [5,8,9]){const r=rows.find(r=>r.resident_id===id);assert.equal(r.state,'unavailable');assert.equal(r.last_sign_in_at,null);}for(const id of [6,7])assert.equal(rows.find(r=>r.resident_id===id).state,'no_account');
 await denied(()=>read(2));await denied(()=>read(2,'private'));await denied(()=>db.exec('select * from auth.users'));await denied(()=>read(null));await denied(()=>read(-1));
 for(const email of ['login@test.invalid','never@test.invalid','contractor@test.invalid','blank@test.invalid','nobody@test.invalid']){await user(email);await denied(()=>read());await denied(()=>read(1,'private'));}
 await user('owner@test.invalid', 'authenticated',null);await denied(()=>read());
 for(const email of ['owner@test.invalid','admin@test.invalid']){await user(email);assert.equal((await read(2)).length,1);assert.equal((await read()).length,9);}
 await user('other@test.invalid');assert.equal((await read(2)).length,1);await denied(()=>read());
 for(const role of ['anon','service_role']){await user('owner@test.invalid',role);await denied(()=>read());await denied(()=>read(1,'private'));}
 await db.exec('reset role');assert.deepEqual((await db.query('select * from auth.users order by id')).rows,before);
 await db.exec("update auth.sessions set refreshed_at=now();update auth.users set updated_at=now();");await user('manager@test.invalid');assert.equal(new Date((await read())[0].last_sign_in_at).toISOString(),'2026-01-01T12:00:00.000Z');
 await db.exec('reset role');await db.exec("update auth.users set last_sign_in_at='2026-02-01T12:00Z' where email='login@test.invalid'");await user('manager@test.invalid');assert.equal(new Date((await read())[0].last_sign_in_at).toISOString(),'2026-02-01T12:00:00.000Z');
 console.log('PASS: scoped owner/admin/manager reads; tenant/contractor/foreign/blank/anonymous/service/helper denial; no direct Auth grants or raw identifiers; case-insensitive existing sign-in lookup; never/no account/ambiguous/deleted/anonymous/future states; no changes to existing Auth rows; simulated refresh/activity does not change sign-in display; later stored sign-in read without backfill.');
}finally{await db.close();}
