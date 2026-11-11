import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {canManageReviewBlock} from "../lib/management-review.ts";
import {validateCreditorState} from "../lib/creditors.ts";
const raw=readFileSync(new URL("../app/api/blocks/[blockId]/statement/route.ts",import.meta.url),"utf8").replace(/^import[^\n]*\n/gm,"").replace("export async function GET","async function GET");
const compiled=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness({role="manager",manager="London",signedIn=true,failTable=null,shortPage=false,oversized=false,invalidState=false}={}){
 const tables={portal_members:[{email:"manager@example.invalid",role,portfolio_manager:manager}],blocks:[{id:1,manager:"London"}],units:Array.from({length:1001},(_,i)=>({id:i+1,block_id:1,unit_number:`Flat ${i+1}`,payment_reference:null})).concat([{id:9000,block_id:2,unit_number:"Foreign",payment_reference:null}]),work_orders:[],service_charge_entries:[{id:1,block_id:1,unit_id:1,entry_type:"Charge",description:"Opening",amount_pence:100,entry_date:"2025-01-01",due_date:null,reference:"A"},{id:2,block_id:1,unit_id:1,entry_type:"Payment",description:"Future",amount_pence:100,entry_date:"2027-01-01",due_date:null,reference:"B"}],supplier_settlements:[],supplier_settlement_allocations:[],management_review_state:invalidState?[{block_id:1,area:"creditors",state:{invoices:[{id:"invalid"}],payments:[]}}]:[]};
 const calls=[];
 class Query{
  constructor(table){this.table=table;this.filters=[];this.bounds=null;this.single=false;}
  select(){return this;}eq(key,value){this.filters.push(row=>row[key]===value);return this;}lte(key,value){this.filters.push(row=>row[key]<=value);return this;}order(){return this;}range(from,to){this.bounds=[from,to];return this;}maybeSingle(){this.single=true;return this;}
  then(resolve,reject){calls.push({table:this.table,bounds:this.bounds});let rows=tables[this.table].filter(row=>this.filters.every(filter=>filter(row)));const count=oversized&&this.table==="units"?100001:rows.length;if(this.bounds)rows=rows.slice(this.bounds[0],this.bounds[1]+1);if(shortPage&&this.table==="units"&&this.bounds?.[0]===0)rows=rows.slice(0,10);return Promise.resolve({data:this.single?rows[0]??null:rows,count,error:this.table===failTable?{message:"failure"}:null}).then(resolve,reject);}
 }
 const client={auth:{getUser:async()=>({data:{user:signedIn?{email:"manager@example.invalid"}:null},error:null})},from:table=>new Query(table)};
 const GET=new Function("NextResponse","createClient","canManageReviewBlock","validateCreditorState","londonDate",`${compiled};return GET;`)({json:(body,options)=>({body,status:options.status})},async()=>client,canManageReviewBlock,validateCreditorState,()=>"2026-12-31");
 return {calls,invoke:(query="start=2026-01-01&end=2026-12-31")=>GET({nextUrl:new URL(`https://example.invalid/statement?${query}`)},{params:Promise.resolve({blockId:"1"})})};
}
test("statement requires authentication and exact manager block scope",async()=>{
 for(const [options,status] of [[{signedIn:false},401],[{role:"resident"},403],[{manager:"Elsewhere"},403]])assert.equal((await harness(options).invoke()).status,status);
 assert.equal((await harness().invoke("start=2026-02-30&end=2026-12-31")).status,400);
 assert.equal((await harness().invoke("start=2026-12-31&end=2026-01-01")).status,400);
});
test("statement reads every page, retains opening ledger and excludes future entries and foreign units",async()=>{
 const h=harness(),result=await h.invoke();assert.equal(result.status,200);assert.equal(result.body.units.length,1001);assert.deepEqual(result.body.entries.map(row=>row.id),[1]);assert.deepEqual(result.body.invoices,[]);assert.equal("payments" in result.body,false);assert.ok(h.calls.some(call=>call.table==="units"&&call.bounds?.[0]===1000));
});
test("incomplete, oversized, unavailable or invalid sources fail the whole statement",async()=>{
 for(const options of [{shortPage:true},{oversized:true},{failTable:"supplier_settlements"},{invalidState:true}]){const result=await harness(options).invoke();assert.equal(result.status,503);assert.equal("units" in result.body,false);assert.ok(result.body.error);}
});
