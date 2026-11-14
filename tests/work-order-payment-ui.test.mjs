import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function harness(file,name,props){
 const source=readFileSync(new URL(`../app/${file}.tsx`,import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^const BuildingStatement=dynamic[^\n]*\n/gm,'').replace('export default function','function');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 const state=[],opened=[],writes=[];let cursor=0,tree;
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})};
 const component=new Function('React','useState','useMemo','useRouter','createClient','Link','BlockDetailsEditor','UnitRegister','ResidentArchiveAction','ServiceChargeRegister','BuildingStatement','confirm',`${js};return ${name};`)(React,useState,fn=>fn(),()=>({refresh(){}}),()=>({from(){writes.push('write');throw Error('Unexpected database mutation');}}),'a','editor','units','archive','charges','statement',()=>true);
 function render(){cursor=0;tree=component({...props,onOpenCreditors:(...args)=>opened.push(args)});}
 function nodes(){const result=[];function walk(n){if(n&&typeof n==='object'){result.push(n);n.children.forEach(walk);}}walk(tree);return result;}
 const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
 render();return {render,nodes,opened,writes,text};
}
const block={id:8,name:'Synthetic Court',address:'Example address',units:1};
const wo={id:42,blockId:8,workOrderNumber:'WO-42',title:'Repair',status:'Open',paymentStatus:'Not approved',priority:'Normal',category:'General',estimatedCost:100,actualCost:null,notes:''};
test('portfolio Paid dropdown opens correct block and work order without asserting payment',()=>{
 const h=harness('WorkOrderRegister','WorkOrderRegister',{blocks:[block],workOrders:[wo],memberRole:'owner',viewerEmail:'owner@example.invalid'});
 const option=h.nodes().find(n=>n.tag==='option'&&n.props.value==='record-payment');assert.match(h.text(option),/Paid/);
 h.nodes().find(n=>n.tag==='select').props.onChange({target:{value:'record-payment'}});
 assert.deepEqual(h.opened,[[8,42]]);assert.deepEqual(h.writes,[]);
});
test('ongoing dropdown records invoice payment without closing or marking contract paid',()=>{
 const h=harness('WorkOrderRegister','WorkOrderRegister',{blocks:[block],workOrders:[{...wo,isOngoing:true}],memberRole:'owner'});
 assert.equal(h.text(h.nodes().find(n=>n.tag==='option'&&n.props.value==='record-payment')),'Record invoice payment…');
 h.nodes().find(n=>n.tag==='select').props.onChange({target:{value:'record-payment'}});assert.deepEqual(h.opened,[[8,42]]);assert.deepEqual(h.writes,[]);
});
test('block status dropdown uses same scoped payment route and financials opens scoped report',()=>{
 const h=harness('BlockDashboard','BlockDashboard',{block,units:[],residents:[],workOrders:[wo],contractors:[],serviceCharges:[],today:'2026-11-14',onBack(){}});
 h.nodes().find(n=>n.tag==='button'&&h.text(n)==='Work orders').props.onClick();h.render();
 const status=h.nodes().find(n=>n.tag==='select'&&n.children.some(c=>c?.props?.value==='record-payment'));
 status.props.onChange({target:{value:'record-payment'}});assert.deepEqual(h.opened,[[8,42]]);assert.deepEqual(h.writes,[]);
 h.nodes().find(n=>n.tag==='button'&&h.text(n)==='Financials').props.onClick();h.render();
 const report=h.nodes().find(n=>n.tag==='statement');assert.equal(report.props.initialBlockId,8);assert.deepEqual(report.props.blocks,[block]);
});
