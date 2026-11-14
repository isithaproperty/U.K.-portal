import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {poundsToPence} from '../lib/creditors.ts';
const source=readFileSync(new URL('../app/WorkOrderCostApproval.tsx',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export default function','function');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
function harness(patch={},response={data:{id:101},error:null}){
 let cursor=0,tree,refreshes=0;const state=[],refs=[],writes=[],filters=[];
 const order={id:101,blockId:8,contractorId:9,workOrderNumber:'WO-101',title:'Cleaning',status:'Open',isOngoing:true,actualCost:null,paymentStatus:'Not approved',updatedAt:'2026-11-15T00:00:00Z',...patch.order};
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=v];};
 const useRef=initial=>{const i=cursor++;return refs[i]??={current:initial};};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})};
 const query={eq(key,value){filters.push([key,value]);return query;},select(){return query;},async single(){return response;}};
 const client={auth:{getUser:async()=>({data:{user:{email:'Manager@Example.invalid'}},error:null})},from(table){assert.equal(table,'work_orders');return {update(patch){writes.push(patch);return query;}};}};
 const component=new Function('React','useState','useRef','useRouter','createClient','poundsToPence',`${js};return WorkOrderCostApproval;`)(React,useState,useRef,()=>({refresh(){refreshes++;}}),()=>client,poundsToPence);
 function render(){cursor=0;tree=component({order,hasSettlements:false,...patch,order});}
 function nodes(){const result=[];function walk(n){if(n&&typeof n==='object'){result.push(n);n.children.forEach(walk);}}walk(tree);return result;}
 render();return {render,nodes,writes,filters,get refreshes(){return refreshes;}};
}
test('creditor cost approval writes explicit cost once with signed-in approval and stale-row protection, never Paid',async()=>{
 const h=harness();h.nodes().find(n=>n.tag==='input').props.onChange({target:{value:'1200.50'}});h.render();const form=h.nodes().find(n=>n.tag==='form'),event={preventDefault(){}};
 await Promise.all([form.props.onSubmit(event),form.props.onSubmit(event)]);assert.equal(h.writes.length,1);assert.equal(h.writes[0].actual_cost,1200.5);assert.equal(h.writes[0].payment_status,'Approved');assert.equal(h.writes[0].payment_approved_by,'manager@example.invalid');assert.deepEqual(h.filters,[['id',101],['block_id',8],['updated_at','2026-11-15T00:00:00Z']]);assert.equal(h.refreshes,1);
});
test('settled/paid, closed ongoing, incomplete one-off, unassigned and disabled approvals cannot mutate costs',async()=>{
 for(const patch of [{hasSettlements:true},{disabled:true},{order:{paymentStatus:'Paid'}},{order:{status:'Complete'}},{order:{status:'Open',isOngoing:false}},{order:{contractorId:null}}]){const h=harness(patch);assert.equal(h.nodes().find(n=>n.tag==='button').props.disabled,true);await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(h.writes.length,0);}
});
test('invalid cost and zero-row updates never claim approval',async()=>{
 const invalid=harness();invalid.nodes().find(n=>n.tag==='input').props.onChange({target:{value:'0'}});invalid.render();await invalid.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(invalid.writes.length,0);
 const stale=harness({order:{actualCost:100}},{data:null,error:null});await stale.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});stale.render();assert.equal(stale.refreshes,0);assert.match(JSON.stringify(stale.nodes().find(n=>n.props.role==='status')),/not confirmed/);
});
