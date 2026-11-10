/** Disposable embedded PostgreSQL only; no database URLs or hosted access.
 * npm install --prefix /tmp/london-db-tests --ignore-scripts @electric-sql/pglite@0.5.16
 * PGLITE_MODULE=/tmp/london-db-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/run-pglite-review.mjs
 */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.env.PGLITE_MODULE)throw new Error('Set PGLITE_MODULE to the installed official PGlite module path.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let db=new PGlite();
async function sql(path){try{const results=await db.exec(await readFile(path,'utf8'));for(const result of results)if(result.rows?.some(row=>row.result))console.log(path,result.rows);console.log('PASS SQL:',path);}catch(error){console.error('FAILED SQL:',path);throw error;}}
try{
 await sql('tests/sql/management-review-bootstrap.sql');
 // Simulate legacy Supabase default grants: migration must revoke unwanted privileges.
 await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated; alter default privileges in schema public grant all on sequences to anon,authenticated;');
 await sql('supabase/building_cashflow.sql');
 await sql('tests/sql/building-cashflow-assertions.sql');
 await sql('supabase/management_review.sql');
 await sql('tests/sql/management-review-assertions.sql');
 for(const path of [
  'tests/sql/management-financial-bootstrap.sql','supabase/service_charges.sql','supabase/automatic_invoice_numbers.sql','tests/sql/management-financial-assertions.sql',
  'tests/sql/supplier-settlements-bootstrap.sql','supabase/supplier_settlements.sql','tests/sql/supplier-settlements-assertions.sql',
  'tests/sql/management-dispatch-bootstrap.sql','supabase/management_dispatch.sql','supabase/communication_delivery.sql','tests/sql/management-dispatch-assertions.sql',
 ])await sql(path);
 await db.close();db=new PGlite();
 await db.exec('create role anon nologin; create role authenticated nologin;');
 for(const path of ['tests/sql/standing-orders-bootstrap.sql','supabase/service_charges.sql','supabase/automatic_invoice_numbers.sql','supabase/bank_reconciliation.sql','supabase/standing_orders.sql','tests/sql/standing-orders-assertions.sql'])await sql(path);
 console.log('PASS: disposable embedded PostgreSQL verification completed.');
}finally{await db.close();}
