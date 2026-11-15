import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {buildPortfolioReport} from '../lib/portfolio-reports.ts';
const source=readFileSync(new URL('../app/PortfolioReports.tsx',import.meta.url),'utf8').replace(/^import.*\n/gm,'').replace('export default function','function');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function harness(count=5){
 let cursor=0,tree;const state=[],refs=[],effects=[],pending=[],calls=[],downloads=[];const blocks=Array.from({length:count},(_,i)=>({id:i+1,name:'Court '+(i+1),address:'Address'}));
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>state[i]=typeof value==='function'?value(state[i]):value]};const useRef=initial=>{const i=cursor++;return refs[i]??={current:initial}};
 const useEffect=(fn,deps)=>{const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=fn())}};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'};
 const fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve,done:false}));
 const URL=class extends globalThis.URL{static createObjectURL(){return 'blob:synthetic'}static revokeObjectURL(){}};const document={createElement:()=>({click(){downloads.push(this.download)}})};
 const component=new Function('React','useState','useRef','useEffect','dynamic','fetch','buildPortfolioReport','URL','document','setTimeout',`${js};return PortfolioReports`)(React,useState,useRef,useEffect,()=> 'single-building',fetch,buildPortfolioReport,URL,document,()=>{});
 function render(){cursor=0;tree=component({blocks,today:'2026-11-15',clientInvoicesEnabled:true});while(pending.length)pending.shift()();}
 const nodes=()=>{const out=[];const walk=n=>{if(n&&typeof n==='object'){out.push(n);n.children.forEach(walk)}};walk(tree);return out};const text=n=>typeof n==='string'?n:typeof n==='number'?String(n):(n?.children??[]).map(text).join('');const button=label=>nodes().find(n=>n.tag==='button'&&text(n)===label);
 async function settle(call,failed=false){assert.ok(call);call.done=true;const block=blocks.find(b=>call.url.includes('/'+b.id+'/portfolio-report'));call.resolve({ok:!failed,json:async()=>failed?{error:'Synthetic failure'}:{kind:'units',block,retrievedAt:'2026-11-15T12:00Z',data:{units:[],entries:[],workOrders:[],invoices:[],settlements:[],allocations:[]},cash:[]}});await new Promise(setImmediate);render();}
 render();return {render,nodes,button,calls,downloads,settle,text};
}
test('bulk report uses at most three initial requests and blocks downloads until complete and reviewed',async()=>{
 const h=harness();h.button('Preview selected statements').props.onClick();h.render();assert.equal(h.calls.length,3);assert.ok(h.calls.every(call=>call.options.cache==='no-store'));await h.settle(h.calls[0]);assert.equal(h.calls.length,4);await h.settle(h.calls[1]);assert.equal(h.calls.length,5);for(const call of h.calls.filter(c=>!c.done))await h.settle(call);
 const download=h.button('Download CSV');assert.ok(download);assert.equal(download.props.disabled,true);const reviewed=h.nodes().find(n=>n.tag==='label'&&h.text(n).includes('I reviewed')).children.find(n=>n?.tag==='input');reviewed.props.onChange({target:{checked:true}});h.render();h.button('Download CSV').props.onClick();assert.equal(h.downloads.length,1);assert.match(h.downloads[0],/^manager-only-units/);
 h.nodes().find(n=>n.tag==='input'&&n.props.type==='date').props.onChange({target:{value:'2026-02-01'}});h.render();assert.equal(h.button('Download CSV'),undefined);
});
test('cancelled or failed selections never expose stale/partial downloads',async()=>{
 const h=harness(2);h.button('Preview selected statements').props.onClick();h.render();h.button('Cancel report').props.onClick();h.render();assert.equal(h.calls[0].options.signal.aborted,true);await h.settle(h.calls[0]);await h.settle(h.calls[1]);assert.equal(h.button('Download CSV'),undefined);
 const failed=harness(2);failed.button('Preview selected statements').props.onClick();failed.render();await failed.settle(failed.calls[0],true);assert.equal(failed.calls[1].options.signal.aborted,true);await failed.settle(failed.calls[1]);assert.equal(failed.button('Download CSV'),undefined);assert.ok(failed.nodes().some(n=>n.props.role==='alert'));
});
test('changing report mode invalidates a prior preview and exposes explicit separate client statuses',()=>{
 const h=harness(1);const select=h.nodes().find(n=>n.tag==='select'&&n.props.value==='units');select.props.onChange({target:{value:'client'}});h.render();assert.ok(h.nodes().some(n=>n.tag==='option'&&n.props.value==='Issued'));assert.ok(h.nodes().some(n=>h.text(n).includes('Client receipts are not tracked')));assert.equal(h.button('Download CSV'),undefined);
});
