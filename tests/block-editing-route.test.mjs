import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {canManageReviewBlock} from '../lib/management-review.ts';
const source=readFileSync(new URL('../app/api/blocks/[blockId]/route.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const original={name:'Test',management_company:'Company',type:'Residential',address:'1 Test Road',manager:'Sam',financial_year_end:'2026-12-31',units:2};
async function run(options={}) {
 const writes=[],filters=[];
 const db={auth:{getUser:async()=>({data:{user:options.signedOut?null:{email:'USER@example.test'}}})},from(table){
 let updating=false;
 const builder={select(){return builder;},eq(key,value){if(updating)filters.push([key,value]);return builder;},update(value){updating=true;writes.push(value);return builder;},async maybeSingle(){
 if(table==='portal_members')return {data:options.member??{role:'manager',portfolio_manager:'Sam'}};
 if(updating)return options.denied?{error:{message:'denied'}}:{data:options.race?null:{id:1}};
 return {data:original};
 },then(resolve,reject){return Promise.resolve({count:options.count??2,error:options.countError?{}:null}).then(resolve,reject);}};
 return builder;
 }};
 const exports={};
 new Function('require','exports',js)((name)=>name==='next/server'?{NextResponse:{json:(body,{status=200}={})=>({body,status})}}:name.endsWith('management-review')?{canManageReviewBlock}:{createClient:async()=>db},exports);
 const details={...original,units:3,...options.details};if(options.missing)delete details[options.missing];
 const result=await exports.PATCH({text:async()=>options.raw??JSON.stringify({details,original:{...original,...options.original}})},{params:Promise.resolve({blockId:options.id??'1'})});
 return {...result,writes,filters};
}
test('block PATCH rejects unauthenticated users and invalid ids',async()=>{
 assert.equal((await run({signedOut:true})).status,401);assert.equal((await run({id:'0'})).status,400);
});
test('block PATCH enforces portfolio and privileged reassignment',async()=>{
 for(const member of [{role:'resident',portfolio_manager:'Sam'},{role:'manager',portfolio_manager:'Other'}])assert.equal((await run({member})).status,403);
 assert.equal((await run({details:{manager:'Other'}})).status,403);
 assert.equal((await run({member:{role:'owner'},details:{manager:'Other'}})).status,200);
 assert.equal((await run({member:{role:'admin'},details:{manager:'Other'}})).status,200);
});
test('block PATCH rejects malformed and incomplete details',async()=>{
 for(const raw of ['{','null','[]','{}'])assert.equal((await run({raw})).status,400);
 for(const missing of Object.keys(original))assert.equal((await run({missing})).status,400);
 for(const details of [{name:' '},{financial_year_end:'2026-02-30'},{financial_year_end:'not a date'},{units:1},{units:2.5},{units:'3'},{units:100001}])assert.equal((await run({details})).status,400);
});
test('block PATCH rejects count below registered units and unverifiable counts',async()=>{
 assert.equal((await run({count:4})).status,400);assert.equal((await run({countError:true})).status,503);
});
test('block PATCH rejects stale original before write and concurrent changes during write',async()=>{
 const stale=await run({original:{name:'Old'}});assert.equal(stale.status,409);assert.equal(stale.writes.length,0);
 assert.equal((await run({race:true})).status,409);
});
test('block PATCH writes only details with all loaded-field concurrency predicates',async()=>{
 const result=await run();assert.equal(result.status,200);assert.deepEqual(result.writes,[{...original,units:3}]);
 assert.deepEqual(Object.fromEntries(result.filters),{id:1,...original});
});
test('block PATCH reports database denial instead of false success',async()=>{
 assert.equal((await run({denied:true})).status,400);
});
