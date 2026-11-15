import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {validateClientInvoiceRequest} from '../lib/client-invoices.ts';
import {buildClientInvoicePdf} from '../lib/client-invoice-pdf.ts';
import {invoiceRecord,invoiceDocument,uuid} from './fixtures/client-invoices.mjs';
function compile(path,names,deps){const raw=readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/export async function/g,'async function').replace(/^export /gm,'');const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;return new Function(...Object.keys(deps),`${js};return {${names.join(',')}};`)(...Object.values(deps));}
const reply=(body,status=200)=>({body,status});
function harness({issuingEnabled=true,role='owner',denied=false,error=null,record=invoiceRecord(),data}={}){
 const calls=[],client={from(table){assert.equal(table,'client_invoices');const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:record,error:null};}};return q;},async rpc(name,args){calls.push({name,args});return {data:data===undefined?{invoice:record,replayed:false}:data,error};}};
 const routes=compile('../app/api/client-invoices/route.ts',['POST'],{clientInvoiceIssuingEnabled:()=>issuingEnabled,clientInvoiceAccess:async()=>denied?{response:reply({error:'Denied'},403)}:{client,member:{role}},reply,validateClientInvoiceRequest,buildClientInvoicePdf,londonDate:()=> '2026-11-15'});
 return {calls,invoke:(body,origin='https://example.invalid')=>routes.POST({headers:new Headers({origin}),nextUrl:new URL('https://example.invalid/api/client-invoices'),text:async()=>JSON.stringify(body)})};
}
const payload=(action='Save')=>({requestId:uuid(100),id:uuid(1),blockId:1,expectedRevision:1,action,...(action==='Save'?{document:invoiceDocument()}:{confirmed:true})});
test('API denies unscoped users, unapproved role transitions, missing confirmations and cross-origin actions',async()=>{
 const h=harness({denied:true});assert.equal((await h.invoke(payload())).status,403);assert.equal(h.calls.length,0);
 const manager=harness({role:'manager'});for(const action of ['Review','Issue','Void'])assert.equal((await manager.invoke({...payload(action),reason:'Correction'})).status,403);assert.equal(manager.calls.length,0);
 assert.equal((await harness().invoke({...payload('Issue'),confirmed:false})).status,400);assert.equal((await harness().invoke(payload(),'https://unrelated.invalid')).status,403);
});
test('saving calls only isolated invoice RPC and reports no delivery or ledger activity',async()=>{
 const h=harness(),result=await h.invoke(payload());assert.equal(result.status,200);assert.equal(result.body.emailSent,false);assert.equal(result.body.ledgerChanged,false);assert.equal(h.calls[0].name,'mutate_client_invoice');assert.deepEqual(h.calls[0].args.p_request,validateClientInvoiceRequest(payload()));
});
test('saved PDF and date validation run before issue; database errors distinguish conflicts from uncertainty',async()=>{
 const bad=harness({record:invoiceRecord({document:{...invoiceDocument(),client:{name:'中文',address:'a',email:''}}})});assert.equal((await bad.invoke(payload('Review'))).status,400);assert.equal(bad.calls.length,0);
 const doc=invoiceDocument();doc.invoiceDate='2999-01-01';doc.dueDate='2999-01-02';const future=harness({record:invoiceRecord({document:doc})});assert.equal((await future.invoke(payload('Issue'))).status,400);assert.equal(future.calls.length,0);
 for(const [code,status,uncertain] of [['40001',409,false],['23505',409,false],['PGRST202',503,false],['XX000',503,true]]){const result=await harness({error:{code,message:'Synthetic failure'}}).invoke(payload());assert.equal(result.status,status);assert.equal(result.body.uncertain,uncertain);}
 assert.equal((await harness({data:null}).invoke(payload())).body.uncertain,true);
});
test('application gate defaults closed before auth/database access, and residents never see invoice navigation',async()=>{
 const old=process.env.LONDON_CLIENT_INVOICES_ENABLED;delete process.env.LONDON_CLIENT_INVOICES_ENABLED;
 try{const api=compile('../lib/client-invoice-access.ts',['clientInvoiceAccess'],{NextResponse:{json:(body,options)=>reply(body,options.status)},createClient:()=>{throw Error('Must not connect');},canManageReviewBlock:()=>true});assert.equal((await api.clientInvoiceAccess()).response.status,503);}finally{if(old===undefined)delete process.env.LONDON_CLIENT_INVOICES_ENABLED;else process.env.LONDON_CLIENT_INVOICES_ENABLED=old;}
 const portal=readFileSync(new URL('../app/Portal.tsx',import.meta.url),'utf8');assert.match(portal,/key!=="client-invoices"\|\|clientInvoicesEnabled/);assert.match(portal,/view==="client-invoices"&&isManager&&clientInvoicesEnabled/);
});

test('draft-only API rejects final issue before any mutation when issuing is disabled',async()=>{const h=harness({issuingEnabled:false});const result=await h.invoke(payload('Issue'));assert.equal(result.status,403);assert.equal(result.body.uncertain,false);assert.equal(h.calls.length,0);});
