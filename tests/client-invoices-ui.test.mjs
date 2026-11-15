import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as model from '../lib/client-invoices.ts';
import {invoiceRecord,uuid} from './fixtures/client-invoices.mjs';
const raw=readFileSync(new URL('../app/ClientInvoiceRegister.tsx',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export default function','function');
const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
function harness({canApprove=true,issuingEnabled=true}={}){
 let cursor=0,tree;const state=[],refs=[],effects=[],pending=[],calls=[],locks=[];
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];};
 const useRef=initial=>{const i=cursor++;return refs[i]??={current:initial};};
 const useEffect=(fn,deps)=>{const i=cursor++,old=effects[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=fn());}};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})};
 const fetch=(url,options={})=>new Promise(resolve=>calls.push({url,options,resolve,done:false}));
 const deps={React,useState,useRef,useEffect,fetch,money:n=>`GBP ${n}`,...model,confirm:()=>true};
 const component=new Function(...Object.keys(deps),`${js};return BlockClientInvoices;`)(...Object.values(deps));
 const lockChange=value=>locks.push(value);
 function render(){cursor=0;tree=component({blockId:1,today:'2026-11-15',canApprove,issuingEnabled,onLockChange:lockChange});while(pending.length)pending.shift()();}
 function nodes(){const out=[];function walk(n){if(n&&typeof n==='object'){out.push(n);n.children.forEach(walk);}}walk(tree);return out;}
 const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');
 const button=label=>nodes().find(n=>n.tag==='button'&&text(n)===label);
 async function settle(call,body,status=200){assert.ok(call,'Missing pending request');call.done=true;call.resolve({ok:status<400,status,json:async()=>body});await new Promise(setImmediate);render();}
 const next=match=>calls.find(c=>!c.done&&match(c));
 async function open(row=invoiceRecord()){
  await settle(next(c=>c.url.includes('?blockId=')),{invoices:[row],total:1,page:0,pageSize:50});button('Open saved invoice').props.onClick();await settle(next(c=>c.url===`/api/client-invoices/${row.id}`),{invoice:row,history:[],historyCount:0});
 }
 render();return {render,nodes,button,calls,settle,next,open,text,locks};
}
test('draft save and explicit review are separate; edits invalidate confirmation and block issue',async()=>{
 const h=harness();await h.open();assert.equal(h.button('Confirm review').props.disabled,true);assert.equal(h.button('Issue final invoice'),undefined);
 h.nodes().filter(n=>n.tag==='input'&&n.props.type==='checkbox').at(-1).props.onChange({target:{checked:true}});h.render();assert.equal(h.button('Confirm review').props.disabled,false);
 const issuer=h.nodes().find(n=>n.tag==='input'&&n.props.value==='Synthetic Management Ltd');issuer.props.onChange({target:{value:'Edited issuer'}});h.render();assert.equal(h.button('Confirm review').props.disabled,true);
 h.button('Save draft').props.onClick();h.button('Save draft').props.onClick();assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);const posted=JSON.parse(h.calls.at(-1).options.body);assert.equal(posted.action,'Save');assert.equal(posted.document.issuer.name,'Edited issuer');assert.equal(posted.document.issuer.vatRegistered,false);
});
test('managers cannot review or issue, and saved issued content is read-only',async()=>{
 const manager=harness({canApprove:false});await manager.open();assert.equal(manager.button('Confirm review'),undefined);assert.equal(manager.button('Issue final invoice'),undefined);
 const issued=harness();await issued.open(invoiceRecord({status:'Issued',invoice_number:'MCI-00000001',issued_at:'2026-01-01'}));assert.equal(issued.button('Save draft'),undefined);assert.ok(issued.nodes().some(n=>n.tag==='fieldset'&&n.props.disabled));assert.ok(issued.nodes().some(n=>n.tag==='a'&&n.props.href.endsWith('/pdf')));
});
test('uncertain issue freezes editing and block switching; inspect then retry keeps exact request UUID and payload',async()=>{
 const h=harness(),row=invoiceRecord({status:'Reviewed',revision:2});await h.open(row);h.nodes().filter(n=>n.tag==='input'&&n.props.type==='checkbox').at(-1).props.onChange({target:{checked:true}});h.render();h.button('Issue final invoice').props.onClick();const post=h.next(c=>c.options.method==='POST');const original=post.options.body;await h.settle(post,{error:'Synthetic uncertain outcome',uncertain:true},503);assert.equal(h.button('New client invoice draft').props.disabled,true);assert.equal(h.button('Retry identical request').props.disabled,true);assert.equal(h.locks.at(-1),true);
 h.button('Reload saved invoice and audit history').props.onClick();await h.settle(h.next(c=>c.url===`/api/client-invoices/${row.id}`),{invoice:row,history:[],historyCount:0});assert.equal(h.button('Retry identical request').props.disabled,false);h.button('Retry identical request').props.onClick();assert.equal(h.next(c=>c.options.method==='POST').options.body,original);
});
test('finding the uncertain request in audit history resolves it without another mutation',async()=>{
 const h=harness(),row=invoiceRecord({status:'Reviewed',revision:2});await h.open(row);h.nodes().filter(n=>n.tag==='input'&&n.props.type==='checkbox').at(-1).props.onChange({target:{checked:true}});h.render();h.button('Issue final invoice').props.onClick();const post=h.next(c=>c.options.method==='POST'),requestId=JSON.parse(post.options.body).requestId;await h.settle(post,{error:'Uncertain',uncertain:true},503);h.button('Reload saved invoice and audit history').props.onClick();await h.settle(h.next(c=>c.url===`/api/client-invoices/${row.id}`),{invoice:invoiceRecord({status:'Issued',revision:3,invoice_number:'MCI-00000001',issued_at:'2026-01-01'}),history:[{revision:3,action:'Issue',actor:'owner@example.invalid',occurred_at:'2026-01-01',request_id:requestId}],historyCount:3});assert.equal(h.button('Retry identical request'),undefined);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.ok(h.nodes().some(n=>n.tag==='a'&&n.props.href.includes('?revision=3')));
});
test('invoice type and tax point are explicit and selecting VAT never supplies a tax rate',async()=>{
 const h=harness();await h.open();
 const type=()=>h.nodes().find(n=>n.tag==='select'&&n.props.value==='non-vat');assert.ok(type());
 type().props.onChange({target:{value:'vat'}});h.render();
 assert.ok(h.nodes().some(n=>n.tag==='label'&&h.text(n).startsWith('VAT tax point')));assert.ok(h.nodes().some(n=>n.tag==='label'&&h.text(n).startsWith('Supply date')));
 assert.equal(h.nodes().find(n=>n.tag==='label'&&h.text(n).startsWith('Reviewed VAT rate')).children.find(n=>n?.tag==='input').props.value,0);
 const select=h.nodes().find(n=>n.tag==='select'&&n.props.value==='vat');select.props.onChange({target:{value:'non-vat'}});h.render();assert.equal(h.nodes().some(n=>n.tag==='label'&&h.text(n).startsWith('VAT tax point')),false);
 h.button('Save draft').props.onClick();const payload=JSON.parse(h.calls.at(-1).options.body);assert.equal(payload.document.invoiceType,'non-vat');assert.equal(payload.document.vatTaxPoint,'');assert.equal(payload.document.issuer.phone,'');
});

test('draft-only UI retains review but hides final issuing',async()=>{const h=harness({issuingEnabled:false});await h.open(invoiceRecord({status:'Reviewed',revision:2}));assert.equal(h.button('Issue final invoice'),undefined);});
