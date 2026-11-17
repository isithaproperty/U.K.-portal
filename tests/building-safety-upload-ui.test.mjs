import {validateSafetyDocument,SAFETY_DOCUMENT_ACCEPT} from '../lib/building-safety-upload.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync(new URL('../app/BuildingSafetyRegister.tsx',import.meta.url),'utf8').replace(/^import.*\n/gm,'').replace('export default function','function');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function harness({uploadError=null,saveError=null,throws=false}={}){
 let cursor=0,tree;const state=[],refs=[],calls=[],refreshes=[];
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]};const useRef=initial=>{const i=cursor++;return refs[i]??={current:initial}};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})};
 const client={auth:{getUser:async()=>({data:{user:{email:'OWNER@Example.invalid'}}})},storage:{from(bucket){return{async upload(path,file,options){calls.push({kind:'upload',bucket,path,file,options});if(throws)throw Error('Network unavailable');return {error:uploadError}},async remove(){calls.push({kind:'remove'});return {error:null}}}}},from(table){return{async insert(payload){calls.push({kind:'insert',table,payload});return {error:saveError}}}}};
 const deps={SAFETY_DOCUMENT_ACCEPT,React,useState,useRef,useMemo:fn=>fn(),useRouter:()=>({refresh:()=>refreshes.push(true)}),createClient:()=>client,styles:new Proxy({},{get:(_,key)=>key}),setTimeout:fn=>fn(),validateSafetyDocument};
 const Component=new Function(...Object.keys(deps),`${js};return BuildingSafetyRegister;`)(...Object.values(deps));
 const props={blocks:[{id:1,name:'Synthetic Court',address:'Synthetic',units:1}],records:[]};function render(){cursor=0;tree=Component(props)}
 function nodes(){const out=[];const walk=n=>{if(n&&typeof n==='object'){out.push(n);n.children.forEach(walk)}};walk(tree);return out}const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');const button=label=>nodes().find(n=>n.tag==='button'&&text(n)===label);
 function choose(file={name:'synthetic.pdf',type:'application/pdf',size:100}){const input=nodes().find(n=>n.tag==='input'&&n.props.ref);input.props.onChange({target:{files:[file],value:'selected'}});render()}
 render();return{render,nodes,text,button,choose,calls,refreshes};
}
test('BSC file selection exposes a save form and uploads the file with the selected block/category',async()=>{
 const h=harness();h.choose();const form=h.nodes().find(n=>n.tag==='form');assert.ok(form,'BSC selection must expose the form');const title=h.nodes().find(n=>n.tag==='input'&&n.props.required);title.props.onChange({target:{value:'Synthetic FRAEW'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.calls[0].bucket,'building-safety-documents');assert.match(h.calls[0].path,/^1\/[a-f0-9-]+-synthetic.pdf$/);assert.equal(h.calls[1].payload.block_id,1);assert.equal(h.calls[1].payload.category,'FRAEW');assert.equal(h.calls[1].payload.created_by,'owner@example.invalid');assert.equal(h.refreshes.length,1);
});
test('Storage rejection never inserts a safety record or reports success',async()=>{
 const h=harness({uploadError:{message:'Policy rejected upload'}});h.choose();h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Synthetic'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.calls.some(c=>c.kind==='insert'),false);assert.equal(h.refreshes.length,0);assert.ok(h.nodes().some(n=>n.props.role==='status'&&h.text(n).includes('Policy rejected upload')));
});
test('network failures release busy state and a failed record save never deletes a stored file',async()=>{
 for(const options of [{throws:true},{saveError:{message:'Record not saved'}}]){const h=harness(options);h.choose();h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Synthetic'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.calls.some(c=>c.kind==='remove'),false);assert.equal(h.refreshes.length,0);assert.ok(h.button('Save report')&&!h.button('Save report').props.disabled);}
});

test('rapid duplicate submissions cannot create duplicate upload/record attempts',async()=>{
 const h=harness();h.choose();h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Synthetic'}});h.render();const form=h.nodes().find(n=>n.tag==='form');await Promise.all([form.props.onSubmit({preventDefault(){}}),form.props.onSubmit({preventDefault(){}})]);assert.equal(h.calls.filter(c=>c.kind==='upload').length,1);assert.equal(h.calls.filter(c=>c.kind==='insert').length,1);
});
test('oversized files are rejected before Storage and existing General/Insurance forms still render',async()=>{
 const h=harness();h.choose({name:'huge.pdf',type:'application/pdf',size:10485761});h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Synthetic'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,0);
 for(const section of ['General Health & Safety','Insurance']){const other=harness();other.button(section).props.onClick();other.render();other.choose();assert.ok(other.nodes().some(n=>n.tag==='form'));}
});
