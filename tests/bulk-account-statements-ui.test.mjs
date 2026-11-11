import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {buildBulkAccountStatements} from '../lib/bulk-account-statements.ts';
const source=readFileSync(new URL('../app/BulkAccountStatements.tsx',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export default function','function');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
const unit={id:1,blockId:1,unitNumber:'1',paymentReference:'CODE'};
const entry={id:1,block_id:1,unit_id:1,entry_type:'Charge',amount_pence:100,entry_date:'2026-01-01',due_date:'2026-01-01',description:'Charge',reference:'A'};
function harness(){
 const state=[],refs=[],effects=[],pending=[],calls=[],downloads=[];let cursor=0,tree,props={block:{id:1,name:'Court',address:'Road'},units:[unit],entries:[entry],today:'2026-11-11',reviewOnly:false};
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];};
 const useRef=initial=>{const i=cursor++;return refs[i]??=( {current:initial});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=effects[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();effects[i]={deps};pending.push(()=>{effects[i].cleanup=fn();});}};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'};
 const fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
 const component=new Function('useState','useRef','useEffect','React','fetch','buildBulkAccountStatements','money','URL','document','setTimeout',`${js};return BulkAccountStatements;`)(useState,useRef,useEffect,React,fetch,buildBulkAccountStatements,n=>String(n),Object.assign(class extends URL {},{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}}),{createElement:()=>({click(){downloads.push(this.download);}})},fn=>fn());
 function render(next){props={...props,...next};cursor=0;tree=component(props);while(pending.length)pending.shift()();cursor=0;tree=component(props);return tree;}
 const nodes=()=>{const out=[];function walk(n){if(n&&typeof n==='object'){out.push(n);n.children.forEach(walk);}}walk(tree);return out;};
 const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
 const button=label=>nodes().find(n=>n.tag==='button'&&text(n).includes(label));
 const settle=async(i=0,data={units:[unit],entries:[entry],asOfGeneratedAt:'2026-11-11T12:00:00Z'},ok=true)=>{calls[i].resolve({ok,json:async()=>data});await new Promise(resolve=>setImmediate(resolve));render();};
 render();return {render,nodes,button,calls,downloads,settle,unmount:()=>effects.forEach(e=>e?.cleanup?.())};
}
test('fresh API scope, duplicate preview lock and review-gated download',async()=>{
 const h=harness();h.button('Preview all').props.onClick();h.button('Preview all').props.onClick();assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/\/api\/blocks\/1\/statement\?start=2026-01-01&end=2026-11-11/);assert.equal(h.calls[0].options.cache,'no-store');await h.settle();assert.equal(h.button('Download all').props.disabled,true);h.nodes().find(n=>n.tag==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();h.button('Download all').props.onClick();assert.equal(h.downloads.length,1);assert.match(h.downloads[0],/^manager-only-/);
});
test('cancel, date change, scope change, new props and unmount abort stale snapshots',async()=>{
 for(const change of ['cancel','date','scope','block','entries','unmount']){
  const h=harness();h.button('Preview all').props.onClick();h.render();
  if(change==='cancel')h.button('Cancel').props.onClick();
  if(change==='date')h.nodes().find(n=>n.tag==='input'&&n.props.type==='date').props.onChange({target:{value:'2026-02-01'}});
  if(change==='scope')h.nodes().find(n=>n.tag==='select').props.onChange({target:{value:'all'}});
  if(change==='block')h.render({block:{id:2,name:'Other',address:'Road'}});
  if(change==='entries')h.render({entries:[]});
  if(change==='unmount')h.unmount();
  assert.equal(h.calls[0].options.signal.aborted,true,change);await h.settle();assert.equal(h.button('Download all'),undefined,change);
 }
});
test('errors and empty results do not offer downloads; close requires a fresh review',async()=>{
 for(const [data,ok] of [[{error:'Unavailable'},false],[{units:[],entries:[],asOfGeneratedAt:'2026-11-11T12:00:00Z'},true],[{units:[{...unit,blockId:2}],entries:[],asOfGeneratedAt:'2026-11-11T12:00:00Z'},true]]){const h=harness();h.button('Preview all').props.onClick();await h.settle(0,data,ok);assert.equal(h.button('Download all'),undefined);}
 const h=harness();h.button('Preview all').props.onClick();await h.settle();h.nodes().find(n=>n.tag==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();h.button('Close preview').props.onClick();h.render();assert.equal(h.button('Download all'),undefined);h.button('Preview all').props.onClick();await h.settle(1);assert.equal(h.button('Download all').props.disabled,true);
});
test('synthetic review uses no network requests and marks downloaded output',async()=>{const h=harness();h.render({reviewOnly:true});h.button('Preview all').props.onClick();h.render();assert.equal(h.calls.length,0);assert.match(h.nodes().find(n=>n.tag==='iframe').props.srcDoc,/SYNTHETIC REVIEW DATA/);});
