/** Disposable SQL authorization test. Does not connect to any hosted database. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema private; create schema storage;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth,private,storage to authenticated;
 create table portal_members(email text,role text,portfolio_manager text);create table blocks(id bigint primary key,manager text);
 create table contractors(id bigint primary key,email text);create table work_orders(id bigint primary key,block_id bigint references blocks(id),contractor_id bigint references contractors(id),status text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to authenticated;
 insert into portal_members values ('owner@test','owner',null),('admin@test','admin',null),('manager@test','manager','London'),('other@test','manager','Other'),('blank@test','manager',' ');
 insert into blocks values (1,'London'),(2,'Other'),(3,' ');insert into contractors values(9,'contractor@test'),(10,'different@test');
 insert into work_orders values (101,1,9,'Open'),(102,2,9,'Open'),(103,1,null,'Open'),(104,1,9,'Cancelled'),(105,3,9,'Open');`);
 await db.exec(await readFile('docs/proposed-staff-work-order-documents.sql','utf8'));
 const uid='11111111-1111-4111-8111-111111111111';
 const user=async(email,role='authenticated',sub=uid)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email,sub})]);await db.exec(`set role ${role}`);};
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const path=(wo,n,kind='invoice')=>`${wo}/${id(n)}/${kind}.pdf`;
 const upload=async(wo,n,options={})=>db.query('insert into storage.objects values($1,$2,$3,$4)', ['staff-work-order-documents',path(wo,n,options.kind),options.owner??uid,JSON.stringify({mimetype:'application/pdf',size:10,...options.metadata})]);
 const record=async(wo,n,kind='invoice')=>db.query('insert into staff_work_order_documents(id,work_order_id,contractor_id,document_type,storage_path,original_name) values($1,$2,9,$3,$4,$5)',[id(n),wo,kind,path(wo,n,kind),'email.pdf']);
 const denied=async(fn)=>assert.rejects(fn);
 await user('manager@test');await upload(101,1);await record(101,1);
 let rows=(await db.query('select * from staff_work_order_documents')).rows;assert.equal(rows.length,1);assert.equal(rows[0].uploaded_by_email,'manager@test');assert.equal(rows[0].contractor_id,9);assert.equal(rows[0].source,'Staff upload');
 await upload(101,2,{kind:'job-card'});await record(101,2,'job-card');
 await denied(()=>upload(102,3));await denied(()=>upload(103,3));await denied(()=>upload(104,3));
 await denied(()=>db.query('insert into storage.objects values($1,$2,$3,$4)', ['staff-work-order-documents','101/invalid/invoice.pdf',uid,JSON.stringify({size:10,mimetype:'application/pdf'})]));
 await denied(()=>record(101,3));await denied(()=>record(101,1));
 await denied(()=>db.exec("update staff_work_order_documents set original_name='changed'"));await denied(()=>db.exec('delete from staff_work_order_documents'));
 await denied(()=>db.exec(`insert into staff_work_order_documents(id,work_order_id,document_type,storage_path,original_name,uploaded_by_email) values('${id(4)}',101,'invoice','${path(101,4)}','a','forged@test')`));
 assert.equal((await db.query("delete from storage.objects returning name")).rows.length,0);
 for(const metadata of [{size:0},{size:10485761},{mimetype:'text/html'}]){await upload(101,5,{metadata});await denied(()=>record(101,5));await db.exec('reset role');await db.query('delete from storage.objects where name=$1',[path(101,5)]);await user('manager@test');}
 await denied(()=>upload(101,6,{owner:'22222222-2222-4222-8222-222222222222'}));
 for(const email of ['other@test','resident@test','blank@test']){await user(email);assert.equal((await db.query('select * from staff_work_order_documents')).rows.length,0);await denied(()=>upload(101,7));await denied(()=>record(101,7));}
 await user('blank@test');await denied(()=>upload(105,7));
 await user('contractor@test');assert.equal((await db.query('select * from staff_work_order_documents')).rows.length,2);assert.equal((await db.query('select * from storage.objects')).rows.length,2);await denied(()=>upload(101,7));
 await user('different@test');assert.equal((await db.query('select * from staff_work_order_documents')).rows.length,0);
 await db.exec('reset role;update work_orders set contractor_id=10 where id=101');
 for(const email of ['contractor@test','different@test']){await user(email);assert.equal((await db.query('select * from staff_work_order_documents')).rows.length,0);}
 await user('manager@test');await upload(101,10);await denied(()=>record(101,10));
 await user('owner@test');assert.equal((await db.query('select * from staff_work_order_documents')).rows.length,2);await upload(102,8);await record(102,8);
 await user('admin@test');await upload(102,9);await record(102,9);
 await user('nobody@test','anon',null);await denied(()=>db.exec('select * from staff_work_order_documents'));
 console.log('PASS: owner/admin/scoped staff inserts; audit attribution; separate document types; foreign manager/resident/contractor/anonymous insert denial; assigned contractor read; reassignment isolation; orphan/forgery/duplicate/invalid metadata denial; cancelled/unassigned rejection; no update/delete.');
}finally{await db.close();}
