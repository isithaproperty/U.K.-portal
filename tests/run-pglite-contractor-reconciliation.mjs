/** Synthetic embedded PostgreSQL only. Never connects to hosted data. */
import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);const db=new PGlite();
const file=async p=>db.exec(await readFile(p,'utf8'));
const scalar=async sql=>(await db.query(sql)).rows[0].n;
try{
 for(const p of ['tests/sql/management-review-bootstrap.sql','tests/sql/management-financial-bootstrap.sql','supabase/service_charges.sql','supabase/automatic_invoice_numbers.sql','supabase/management_review.sql','tests/sql/supplier-settlements-bootstrap.sql','supabase/supplier_settlements.sql','supabase/bank_reconciliation.sql','supabase/building_cashflow.sql'])await file(p);
 await db.exec("alter table work_orders add column work_order_number text;update work_orders set work_order_number='WO-'||id;");
 await file('docs/proposed-whole-block-reconciliation.sql');
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
 console.log('PASS: atomic unified import, reimport dedupe, scoped owner approval, batch rollback, partial/full settlement, idempotent replay.');
}finally{await db.close();}
