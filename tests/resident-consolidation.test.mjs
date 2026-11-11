import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=name=>readFileSync(new URL(`../app/${name}.tsx`,import.meta.url),'utf8');
function harness(name,props){
 const raw=source(name).replace(/^import[^\n]*\n/gm,'').replace('export default function','function');
 const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 let cursor=0,tree;const state=[];
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=v];};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'};
 const component=new Function('useState','React','ResidentArchiveAction','useMemo','useRouter','ResidentDirectory','reconcileShares',`${js};return ${name};`)(useState,React,'archive-action',fn=>fn(),()=>({refresh(){}}),'resident-directory',()=>({sourceTotal:100,adjusted:false}));
 function render(){cursor=0;tree=component(props);}
 function nodes(){const out=[];function walk(n){if(n&&typeof n==='object'){out.push(n);n.children.forEach(walk);}}walk(tree);return out;}
 const text=n=>typeof n==='string'?n:typeof n==='number'?String(n):(n?.children??[]).map(text).join('');
 const button=label=>nodes().find(n=>n.tag==='button'&&text(n)===label);
 render();return{render,nodes,button,text};
}
const blocks=[{id:1,name:'First Court',address:'First address'},{id:2,name:'Second Court',address:'Second address'}];
const units=[{id:11,blockId:1,unitNumber:'Flat 1'},{id:21,blockId:2,unitNumber:'Flat 9'},{id:12,blockId:1,unitNumber:'Empty unit'}];
const residents=[{id:1,blockId:1,unitId:11,fullName:'Alice Active',email:'alice@example.invalid',phone:'020123'},{id:2,blockId:2,unitId:21,fullName:'Bob Active',email:'bob@example.invalid',phone:'020456'},{id:3,blockId:1,unitId:11,fullName:'Archived Person',email:'old@example.invalid',archivedAt:'2026-01-01'}];
test('one manager-only sidebar entry retains unit management and contextual building residents',()=>{
 const portal=source('Portal');assert.match(portal,/\["units","Units & residents"/);assert.doesNotMatch(portal,/\["residents","Residents"|view==="residents"|function ResidentRegister/);assert.match(portal,/view==="units"&&isManager/);assert.match(source('BlockDashboard'),/tab==="residents"/);
});
test('directory searches every supported field across blocks and preserves archive actions',()=>{
 const h=harness('ResidentDirectory',{blocks,units,residents});
 const rows=()=>h.nodes().filter(n=>n.tag==='archive-action').map(n=>n.props.resident.id);
 assert.deepEqual(rows(),[1,2]);
 for(const query of ['BOB','bob@example','020456','Flat 9','Second Court']){h.nodes().find(n=>n.tag==='input').props.onChange({target:{value:query}});h.render();assert.deepEqual(rows(),[2]);}
 h.nodes().find(n=>n.tag==='input').props.onChange({target:{value:''}});h.nodes().find(n=>n.tag==='select').props.onChange({target:{value:'1'}});h.render();assert.deepEqual(rows(),[1]);
 h.button('Archive').props.onClick();h.render();assert.deepEqual(rows(),[3]);
 h.button('Current residents').props.onClick();h.render();assert.deepEqual(rows(),[1]);
 h.nodes().find(n=>n.tag==='input').props.onChange({target:{value:'not found'}});h.render();assert.ok(h.nodes().some(n=>h.text(n)==='No matching residents'));
});
test('view switching preserves unit form input, resident data and importer guidance',()=>{
 const h=harness('UnitRegister',{blocks,units,residents,initialBlockId:1});
 const input=()=>h.nodes().find(n=>n.tag==='input'&&n.props.placeholder==='For example: Flat 1');
 input().props.onChange({target:{value:'Unsaved flat'}});h.render();h.button('Find residents · all blocks').props.onClick();h.render();assert.equal(input().props.value,'Unsaved flat');
 assert.equal(h.nodes().find(n=>n.tag==='resident-directory').props.residents,residents);
 h.button('Manage units & residents').props.onClick();h.render();assert.equal(input().props.value,'Unsaved flat');
 const raw=source('UnitRegister');assert.match(raw,/financial-message permission/);assert.match(raw,/Preview tenant portal/);assert.match(raw,/service_charge_percentage:percentage/);assert.match(raw,/ResidentArchiveAction resident=\{person\}/);
});
