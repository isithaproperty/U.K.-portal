import {canManageBlock} from '../lib/manager-cover.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {validateReportRange} from '../lib/portfolio-reports.ts';import {invoiceRecord,uuid} from './fixtures/client-invoices.mjs';
const raw=readFileSync(new URL('../app/api/blocks/[blockId]/portfolio-report/route.ts',import.meta.url),'utf8').replace(/^import.*\n/gm,'').replace(/^export const dynamic=.*\n/gm,'').replace('export async function GET','async function GET');const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness({email='staff@example.invalid',requestedBlock=1,role='manager',portfolio='London',manager='London',auth=true,stale=false,short=false,oversized=false,bankTruncated=false,statementFailure=false,invoices=Array.from({length:101},(_,i)=>invoiceRecord({id:uuid(i+1)}))}={}){
 const calls=[],reply=(body,status=200)=>({body,status,ok:status<400,json:async()=>body});
 const client={auth:{getUser:async()=>({data:{user:auth?{email}:null}})},from(table){calls.push(table);let selection,bounds,selectedId=1;const q={select(value){selection=value;return q},eq(key,value){if(table==='blocks'&&key==='id')selectedId=value;return q},order(){return q},range(a,b){bounds=[a,b];return q},maybeSingle:async()=>({data:table==='portal_members'?{email,role,portfolio_manager:portfolio}:{id:selectedId,name:'Synthetic Court',address:'Synthetic address',manager:selectedId===1?manager:'Other'}}),then(resolve){let data=invoices.slice(bounds[0],bounds[1]+1);if(selection==='id,revision')data=data.map(row=>({id:row.id,revision:row.revision+(stale?1:0)}));if(short&&bounds[0]===0)data=data.slice(0,1);return Promise.resolve({data,count:oversized?2501:invoices.length,error:null}).then(resolve)}};return q}};
 const GET=new Function('NextResponse','createClient','statementGET','cashflowGET','validateReportRange','londonDate','canManageBlock',`${js};return GET`)( {json:(body,{status,headers})=>({...reply(body,status),headers})},async()=>client,async()=>{calls.push('statementGET');return reply({units:[],workOrders:[],entries:[],invoices:[],settlements:[],allocations:[]},statementFailure?503:200)},async()=>{calls.push('cashflowGET');return reply({rows:[],count:0,truncated:bankTruncated})},validateReportRange,()=> '2026-11-15',canManageBlock);
 return {calls,async invoke(kind='client',query='start=2026-01-01&end=2026-11-15'){const previous=process.env.LONDON_CLIENT_INVOICES_ENABLED;process.env.LONDON_CLIENT_INVOICES_ENABLED='true';try{return await GET({nextUrl:new URL(`https://example.invalid/api/blocks/${requestedBlock}/portfolio-report?kind=${kind}&${query}`)},{params:Promise.resolve({blockId:String(requestedBlock)})})}finally{if(previous===undefined)delete process.env.LONDON_CLIENT_INVOICES_ENABLED;else process.env.LONDON_CLIENT_INVOICES_ENABLED=previous;}}};
}
test('portfolio data is authenticated, role-scoped and rejects blank or foreign manager assignments',async()=>{
 for(const [opts,status] of [[{auth:false},401],[{role:'resident'},403],[{role:'contractor'},403],[{portfolio:'Other'},403],[{portfolio:'  ',manager:'  '},403]]){const h=harness(opts),r=await h.invoke();assert.equal(r.status,status);assert.equal(h.calls.includes('client_invoices'),false);assert.equal(h.calls.includes('statementGET'),false);}
 const foreign=harness({requestedBlock:2});assert.equal((await foreign.invoke('units')).status,403);assert.equal(foreign.calls.includes('statementGET'),false);assert.equal(foreign.calls.includes('client_invoices'),false);
 for(const role of ['owner','admin'])assert.equal((await harness({role,portfolio:null}).invoke()).status,200);
});
test('client summary reads every page and rechecks IDs/revisions with private no-store responses',async()=>{
 const h=harness(),r=await h.invoke();assert.equal(r.status,200);assert.equal(r.body.invoices.length,101);assert.equal(h.calls.filter(t=>t==='client_invoices').length,4);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(r.body.block.id,1);
 for(const opts of [{stale:true},{short:true},{oversized:true}]){const failed=await harness(opts).invoke();assert.equal(failed.status,503);assert.equal('invoices' in failed.body,false);}
});
test('building statement and bank completeness are independent and no posting RPC is called',async()=>{
 const units=harness(),u=await units.invoke('units');assert.equal(u.status,200);assert.equal(units.calls.includes('cashflowGET'),false);
 const b=harness(),r=await b.invoke('buildings');assert.equal(r.status,200);assert.ok(b.calls.includes('statementGET'));assert.ok(b.calls.includes('cashflowGET'));
 for(const opts of [{bankTruncated:true},{statementFailure:true}])assert.equal((await harness(opts).invoke('buildings')).status,503);
 for(const query of ['start=2026-02-30&end=2026-11-15','start=2026-01-01&end=2026-11-16'])assert.equal((await harness().invoke('units',query)).status,400);
});

test('both named managers export colleague reports while unrelated managers and portfolios remain denied',async()=>{
 for(const [email,portfolio,manager] of [['ramiro@aviaf.co.uk','Ramiro Naidoo','Jillian'],['jillian@aviaf.co.uk','Jillian','Ramiro Naidoo']]){
  for(const kind of ['units','buildings','client'])assert.equal((await harness({email,portfolio,manager}).invoke(kind)).status,200);
  const h=harness({email,portfolio,manager:'Bobby'});assert.equal((await h.invoke()).status,403);assert.equal(h.calls.includes('client_invoices'),false);
 }
 assert.equal((await harness({email:'lookalike@test.invalid',portfolio:'Ramiro Naidoo',manager:'Jillian'}).invoke()).status,403);
});
