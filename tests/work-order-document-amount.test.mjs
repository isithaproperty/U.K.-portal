import {canManageBlock} from '../lib/manager-cover.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {workOrderAmount,workOrderAmountDisplay} from '../supabase/functions/_shared/work-order-amount.ts';
test('contractor amount uses approved agreed cost, otherwise clearly identifies the order estimate',()=>{
 assert.deepEqual(workOrderAmount({estimated_cost:'125.50',actual_cost:'99',payment_status:'Not approved'}),{amountPence:12550,basis:'Estimated',isOngoing:false});
 assert.equal(workOrderAmount({estimated_cost:150,actual_cost:100,payment_status:'Approved'}).amountPence,10000);
 assert.equal(workOrderAmount({actual_cost:100,payment_status:'Paid'}).basis,'Agreed');
 for(const bad of [null,undefined,'',-1,'bad',Infinity,1.001])assert.equal(workOrderAmount({estimated_cost:bad}).amountPence,null);
 assert.equal(workOrderAmount({estimated_cost:0}).amountPence,0);
});
test('ongoing contract amount cannot be mistaken for each monthly invoice, and old snapshots remain explicit',()=>{
 const amount=workOrderAmountDisplay(workOrderAmount({estimated_cost:1200,is_ongoing:true}));assert.equal(amount.value,'£1,200.00');assert.match(amount.label,/Estimated ongoing contract total/);assert.match(amount.note,/annual total, not each monthly invoice/);
 assert.match(workOrderAmountDisplay().value,/Not recorded in this sent work order/);
});
test('document renderer and outgoing email include the same amount without reinstating cost controls',()=>{
 const source=readFileSync(new URL('../app/WorkOrderDocument.tsx',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export default function','function').replace(/^export /gm,'');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})};
 const component=new Function('React','workOrderAmountDisplay',`${js};return WorkOrderDocument;`)(React,workOrderAmountDisplay);
 const document={issuedAt:'2026-11-15',number:'WO-1',orderAmount:workOrderAmount({estimated_cost:1200,is_ongoing:true})};
 const rendered=JSON.stringify(component({document}));assert.match(rendered,/£1,200.00/);assert.match(rendered,/ongoing contract total/);
 const edge=readFileSync(new URL('../supabase/functions/work-order-workflow/index.ts',import.meta.url),'utf8');assert.match(edge,/orderAmount:workOrderAmount\(wo\)/);assert.match(edge,/esc\(amount.label\).*esc\(amount.value\)/);assert.match(edge,/esc\(amount.note\)/);
 for(const file of ['WorkOrderRegister','BlockDashboard'])assert.doesNotMatch(readFileSync(new URL(`../app/${file}.tsx`,import.meta.url),'utf8'),/<label>Actual cost|<th>Actual cost/);
});

test('edge send path places the frozen order amount in snapshot and email using a synthetic email transport only',async()=>{
 const source=readFileSync(new URL('../supabase/functions/work-order-workflow/index.ts',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 let handler,snapshot;const sent=[];
 const rows={work_orders:{id:1,block_id:8,contractor_id:9,work_order_number:'WO-1',title:'Annual cleaning',status:'Open',estimated_cost:1200,payment_status:'Not approved',is_ongoing:true},blocks:{id:8,name:'Synthetic Court',manager:'London',address:'Example'},contractors:{id:9,company_name:'Synthetic supplier',email:'contractor@example.invalid',status:'Approved'},portal_members:{role:'owner'}};
 const db={auth:{getUser:async()=>({data:{user:{email:'owner@example.invalid'}},error:null})},rpc:async()=>({data:[],error:null}),from(table){const q={select(){return q;},eq(){return q;},upsert(value){snapshot=value.snapshot;return q;},update(){return q;},async maybeSingle(){return {data:rows[table]??null,error:null};},async single(){return {data:table==='work_order_dispatches'?{id:7}:rows[table],error:null};},then(resolve){resolve({error:null});}};return q;}};
 const Deno={serve(fn){handler=fn;},env:{get(name){return {SUPABASE_URL:'https://example.invalid',SUPABASE_SECRET_KEYS:'{"default":"synthetic"}',RESEND_API_KEY:'synthetic',RESEND_FROM_EMAIL:'noreply@example.invalid'}[name];}}};
 new Function('Deno','createClient','fetch','workOrderAmount','workOrderAmountDisplay','canManageBlock',js)(Deno,()=>db,async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return {ok:true};},workOrderAmount,workOrderAmountDisplay,canManageBlock);
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({event:'send',workOrderId:1})}));
 assert.equal(response.status,200);assert.equal(snapshot.orderAmount.amountPence,120000);assert.equal(sent.length,1);assert.match(sent[0].html,/Estimated ongoing contract total: £1,200.00/);assert.match(sent[0].html,/annual total, not each monthly invoice/);
});
