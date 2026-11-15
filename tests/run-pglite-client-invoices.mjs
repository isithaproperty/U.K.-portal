/** Disposable embedded PostgreSQL. Never points at a hosted project. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {invoiceDocument,uuid} from './fixtures/client-invoices.mjs';
import {clientInvoiceTotals} from '../lib/client-invoices.ts';
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE to an installed disposable PGlite module.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();let requestNumber=1000;
const as=async email=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uuid(999),email})]);await db.exec('set role authenticated');};
const request=(action,id,expectedRevision,extra={})=>({requestId:uuid(requestNumber++),id,blockId:1,expectedRevision,action,...(action==='Save'?{document:invoiceDocument()}:{confirmed:true}),...extra});
const run=async p=>{const result=await db.query('select public.mutate_client_invoice($1::jsonb) as result',[JSON.stringify(p)]);if(!result.rows.length)throw Error('RPC unexpectedly returned no result');return result.rows[0].result;};
try{
 await db.exec(await readFile('tests/sql/management-review-bootstrap.sql','utf8'));
 await db.exec("create schema private;alter table blocks add column name text not null default 'Synthetic Court',add column address text not null default 'Synthetic address';insert into portal_members values('admin@example.invalid','admin',null),('contractor@example.invalid','contractor',null);create table service_charge_entries(id bigint);create table supplier_settlements(id bigint)");
 await db.exec(await readFile('docs/proposed-client-invoices.sql','utf8'));
 await as('manager@example.invalid');const id=uuid(10),save=request('Save',id,0);let result=await run(save);assert.equal(result.invoice.status,'Draft');assert.equal(result.invoice.invoice_number,null);assert.equal((await run(save)).replayed,true);assert.equal((await db.query('select actor_id from client_invoice_events where invoice_id=$1',[id])).rows[0].actor_id,uuid(999));
 await assert.rejects(run({...save,document:{...save.document,reference:'different'}}),/another action/);
 await assert.rejects(run(request('Review',id,1)),/Owner or admin/);
 await assert.rejects(run(request('Save',id,1,{blockId:2})),/Manager block access/);
 await assert.rejects(db.exec("update client_invoices set status='Issued'"),/permission denied/);await assert.rejects(db.exec('delete from client_invoices'),/permission denied/);await assert.rejects(db.exec("update client_invoice_events set actor='forged'"),/permission denied/);
 await as('other@example.invalid');assert.equal((await db.query('select * from client_invoices')).rows.length,0);assert.equal((await db.query('select * from client_invoice_events')).rows.length,0);
 for(const email of ['tenant@example.invalid','contractor@example.invalid']){await as(email);await assert.rejects(run(request('Save',uuid(20),0)),/Manager block access/);assert.equal((await db.query('select * from client_invoices')).rows.length,0);}
 await as('owner@example.invalid');result=await run(request('Review',id,1));assert.equal(result.invoice.status,'Reviewed');assert.equal(result.invoice.revision,2);
 await assert.rejects(run(request('Issue',id,2)),/not been activated/);
 result=await run(request('Save',id,2));assert.equal(result.invoice.status,'Draft');assert.equal(result.invoice.reviewed_at,null);assert.equal(result.invoice.revision,3);await assert.rejects(run(request('Issue',id,3)),/Review this exact/);await assert.rejects(run(request('Review',id,2)),/Saved invoice changed/);
 await db.exec('reset role;update private.client_invoice_configuration set issuing_enabled=true');await as('admin@example.invalid');result=await run(request('Review',id,3));const issue=request('Issue',id,4);result=await run(issue);assert.equal(result.invoice.invoice_number,'MCI-00000001');assert.equal(result.invoice.status,'Issued');assert.equal((await run(issue)).invoice.invoice_number,'MCI-00000001');assert.equal((await run(issue)).replayed,true);
 await assert.rejects(run(request('Save',id,5)),/immutable/);await assert.rejects(run(request('Issue',id,4)),/Saved invoice changed/);
 const original=(await db.query('select snapshot from client_invoice_events where invoice_id=$1 and action=\'Issue\'',[id])).rows[0].snapshot;
 result=await run(request('Void',id,5,{reason:'Corrected client details'}));assert.equal(result.invoice.status,'Voided');assert.equal(result.invoice.invoice_number,original.invoice_number);assert.deepEqual((await db.query('select snapshot from client_invoice_events where invoice_id=$1 and action=\'Issue\'',[id])).rows[0].snapshot,original);
 assert.equal((await db.query('select * from client_invoice_events where invoice_id=$1',[id])).rows.length,6);
 const invalid=invoiceDocument();invalid.lines[0].vatRateBps=2000;await assert.rejects(run(request('Save',uuid(30),0,{document:invalid})),/unconfigured VAT/);
 await assert.rejects(run(request('Save',uuid(31),0,{document:{...invoiceDocument(),currency:null}})),/Invalid GBP/);
 await assert.rejects(run({...request('Save',uuid(32),0),expectedRevision:0.5}),/whole block and revision/);
 for(let i=0;i<15;i++){const doc=invoiceDocument();doc.issuer={...doc.issuer,vatRegistered:true,vatNumber:'GB-SYNTHETIC'};doc.lines[0]={...doc.lines[0],quantityMilli:500+i*137,unitPricePence:101+i*43,vatRateBps:i%2?2000:500};const row=(await run(request('Save',uuid(100+i),0,{document:doc}))).invoice,totals=clientInvoiceTotals(doc);assert.equal(row.net_pence,totals.netPence);assert.equal(row.vat_pence,totals.vatPence);assert.equal(row.total_pence,totals.totalPence);}
 const future=invoiceDocument();future.invoiceDate='2999-01-01';future.dueDate='2999-01-31';await run(request('Save',uuid(200),0,{document:future}));await run(request('Review',uuid(200),1));await assert.rejects(run(request('Issue',uuid(200),2)),/Future-dated/);
 const unrenderable=invoiceDocument();unrenderable.client.name='中文';await run(request('Save',uuid(202),0,{document:unrenderable}));await assert.rejects(run(request('Review',uuid(202),1)),/Western European/);
 await db.exec("reset role;select setval('private.client_invoice_number_seq',99999999)");await as('owner@example.invalid');await run(request('Save',uuid(203),0));await run(request('Review',uuid(203),1));assert.equal((await run(request('Issue',uuid(203),2))).invoice.invoice_number,'MCI-100000000');
 const collisionId=uuid(201);await run(request('Save',collisionId,0));const attempts=await Promise.allSettled([run(request('Save',collisionId,1)),run(request('Save',collisionId,1))]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from service_charge_entries')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from supplier_settlements')).rows[0].n,0);
 const functions=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('mutate_client_invoice','client_invoice_can_manage','validate_client_invoice_document','client_invoice_label','client_invoice_keys','client_invoice_pdf_text')")).rows;assert.ok(functions.every(f=>f.proconfig?.includes('search_path=\"\"')));assert.equal(functions.filter(f=>f.nspname==='public'&&f.prosecdef).length,0);
 const exposure=(await db.query("select has_table_privilege('authenticated','client_invoices','INSERT') ins,has_table_privilege('authenticated','client_invoice_events','DELETE') del,has_sequence_privilege('authenticated','private.client_invoice_number_seq','USAGE') seq,has_function_privilege('anon','public.mutate_client_invoice(jsonb)','EXECUTE') anon")).rows[0];assert.deepEqual(exposure,{ins:false,del:false,seq:false,anon:false});
 await db.exec('set role anon');await assert.rejects(run(request('Save',uuid(300),0)),/permission denied/);
 console.log('PASS: standalone drafts, scoped RLS, manager/owner/admin permissions, gated issue, stable distinct numbering, idempotent replay, stale revisions, immutable issue/void audit, exact VAT parity, invalid/future-date guards, denied direct writes and unchanged resident/supplier ledgers.');
}finally{await db.close();}
