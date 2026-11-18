import {validateSafetyDocument,SAFETY_DOCUMENT_ACCEPT} from '../lib/building-safety-upload.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync(new URL('../app/BuildingSafetyRegister.tsx',import.meta.url),'utf8').replace(/^import.*\n/gm,'').replace('export default function','function');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function harness({records=[],blocks=null,email='OWNER@Example.invalid',blockId=1,uploadError=null,saveError=null,throws=false}={}){
 let cursor=0,tree;const state=[],refs=[],calls=[],refreshes=[];
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]};const useRef=initial=>{const i=cursor++;return refs[i]??={current:initial}};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})};
 const client={auth:{getUser:async()=>({data:{user:{email}}})},storage:{from(bucket){return{async upload(path,file,options){calls.push({kind:'upload',bucket,path,file,options});if(throws)throw Error('Network unavailable');return {error:uploadError}},async createSignedUrl(path,ttl){calls.push({kind:'signed-url',bucket,path,ttl});return {data:{signedUrl:'https://synthetic.invalid/signed'}}},async remove(){calls.push({kind:'remove'});return {error:null}}}}},from(table){return{async insert(payload){calls.push({kind:'insert',table,payload});return {error:saveError}}}}};
 const deps={window:{open:(...args)=>calls.push({kind:'open-window',args})},SAFETY_DOCUMENT_ACCEPT,React,useState,useRef,useMemo:fn=>fn(),useRouter:()=>({refresh:()=>refreshes.push(true)}),createClient:()=>client,styles:new Proxy({},{get:(_,key)=>key}),setTimeout:fn=>fn(),validateSafetyDocument};
 const Component=new Function(...Object.keys(deps),`${js};return BuildingSafetyRegister;`)(...Object.values(deps));
 const props={blocks:blocks??[{id:blockId,name:'Synthetic Court',address:'Synthetic',units:1}],records};function render(){cursor=0;tree=Component(props)}
 function nodes(){const out=[];const walk=n=>{if(n&&typeof n==='object'){out.push(n);n.children.forEach(walk)}};walk(tree);return out}const text=n=>typeof n==='string'?n:(n?.children??[]).map(text).join('');const button=label=>nodes().find(n=>n.tag==='button'&&text(n)===label);
 function choose(file={name:'synthetic.pdf',type:'application/pdf',size:100}){const input=nodes().find(n=>n.tag==='input'&&n.props.ref);input.props.onChange({target:{files:[file],value:'selected'}});render()}
 render();return{render,nodes,text,button,choose,calls,refreshes};
}
test('BSC file selection exposes a save form and uploads the file with the selected block/category',async()=>{
 const h=harness();h.button('FRAEW').props.onClick();h.render();h.choose();const form=h.nodes().find(n=>n.tag==='form');assert.ok(form,'BSC selection must expose the form');const title=h.nodes().find(n=>n.tag==='input'&&n.props.required);title.props.onChange({target:{value:'Synthetic FRAEW'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.calls[0].bucket,'building-safety-documents');assert.match(h.calls[0].path,/^1\/[a-f0-9-]+-synthetic.pdf$/);assert.equal(h.calls[1].payload.block_id,1);assert.equal(h.calls[1].payload.category,'FRAEW');assert.equal(h.calls[1].payload.created_by,'owner@example.invalid');assert.equal(h.refreshes.length,1);
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

test('combined covered-portfolio form retains selected block and the actual covering manager identity',async()=>{
 for(const [email,blockId] of [['ramiro@aviaf.co.uk',2],['jillian@aviaf.co.uk',1]]){
  const h=harness({email,blockId});h.choose();h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Synthetic covered report'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});
  assert.equal(h.calls[0].bucket,'building-safety-documents');assert.ok(h.calls[0].path.startsWith(blockId+'/'));assert.equal(h.calls[1].payload.block_id,blockId);assert.equal(h.calls[1].payload.created_by,email);assert.equal(h.refreshes.length,1);
 }
});

const record=(id,blockId,category,title,createdAt='2026-11-01T12:00:00Z')=>({id,blockId,category,title,createdAt,createdBy:'jillian@aviaf.co.uk',status:'Under review',dueDate:null,notes:'Synthetic revision notes',storagePath:blockId+'/synthetic-'+id+'.pdf',fileName:'synthetic.pdf'});
test('one expanded BSC section reuses existing Safety Case Report records and retains all supporting folders',()=>{
 const records=[record(1,1,'Safety Case Report','Existing BSC report'),record(2,1,'FRAEW','Existing wall report'),record(3,2,'Safety Case Report','Other building report')],before=JSON.stringify(records),h=harness({records});
 assert.equal(h.nodes().filter(n=>n.tag==='button'&&n.props['aria-pressed']!==undefined&&h.text(n)==='Building Safety Case (BSC)').length,1);
 assert.ok(h.nodes().some(n=>n.tag==='h2'&&h.text(n)==='Safety Case Report'));
 assert.ok(h.nodes().some(n=>n.tag==='h3'&&h.text(n)==='Existing BSC report'));
 assert.equal(h.nodes().some(n=>n.tag==='h3'&&h.text(n)==='Other building report'),false);
 h.button('FRAEW').props.onClick();h.render();assert.ok(h.nodes().some(n=>n.tag==='h3'&&h.text(n)==='Existing wall report'));assert.equal(JSON.stringify(records),before);assert.equal(h.calls.length,0);
});
test('DARP uses the confirmed name and separate newest-first per-building document history without fabricated approval',()=>{
 const h=harness({records:[record(1,1,'DARP','Old draft'),record(2,1,'DARP','New draft','2026-11-17T12:00:00Z'),record(3,2,'DARP','Other building DARP'),record(4,1,'Safety Case Report','BSC evidence')]});h.button('DARP').props.onClick();h.render();
 assert.ok(h.nodes().some(n=>n.tag==='h2'&&h.text(n)==='Disaster Action and Recovery Procedure (DARP)'));
 assert.deepEqual(h.nodes().filter(n=>n.tag==='h3').map(n=>h.text(n)),['New draft','Old draft']);
 assert.ok(h.nodes().some(n=>n.tag==='p'&&h.text(n).includes('Uploaded')&&h.text(n).includes('jillian@aviaf.co.uk')));
 assert.ok(h.nodes().some(n=>n.tag==='span'&&h.text(n).includes('does not record approval')));assert.equal(h.calls.length,0);
});
test('DARP uploads a new reviewed-or-draft revision using existing scoped storage without overwriting prior documents',async()=>{
 const h=harness({email:'ramiro@aviaf.co.uk',blockId:2});h.button('DARP').props.onClick();h.render();h.choose();h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Synthetic DARP draft'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});
 assert.equal(h.calls[0].bucket,'building-safety-documents');assert.ok(h.calls[0].path.startsWith('2/'));assert.equal(h.calls[0].options.upsert,false);assert.equal(h.calls[1].payload.category,'DARP');assert.equal(h.calls[1].payload.created_by,'ramiro@aviaf.co.uk');assert.equal(h.calls[1].payload.status,'Under review');assert.equal(h.calls[1].payload.block_id,2);assert.equal(h.calls.some(c=>c.kind==='remove'),false);
});
test('switching document areas or buildings clears pending file/details and prevents a file being silently retargeted',async()=>{
 const h=harness({blocks:[{id:1,name:'One',address:'One',units:1},{id:2,name:'Two',address:'Two',units:1}]});h.choose();h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Old building title'}});h.render();
 h.button('DARP').props.onClick();h.render();assert.equal(h.nodes().some(n=>n.tag==='form'),false);h.choose();assert.equal(h.nodes().find(n=>n.tag==='input'&&n.props.required).props.value,'');
 h.nodes().find(n=>n.tag==='select'&&n.props.value===1).props.onChange({target:{value:'2'}});h.render();assert.equal(h.nodes().some(n=>n.tag==='form'),false);assert.equal(h.calls.length,0);
});
test('DARP and BSC document links use existing short-lived private signed URLs',async()=>{
 for(const category of ['DARP','Safety Case Report']){const h=harness({records:[record(1,1,category,'Private document')]});if(category==='DARP'){h.button('DARP').props.onClick();h.render();}await h.button('Open document').props.onClick();assert.deepEqual(h.calls[0],{kind:'signed-url',bucket:'building-safety-documents',path:'1/synthetic-1.pdf',ttl:300});assert.equal(h.calls[1].kind,'open-window');assert.deepEqual(h.calls[1].args.slice(1),['_blank','noopener,noreferrer']);}
});

test('DARP keeps the existing format limits and rejects Word documents before any upload',async()=>{
 const h=harness();h.button('DARP').props.onClick();h.render();h.choose({name:'synthetic.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:100});h.nodes().find(n=>n.tag==='input'&&n.props.required).props.onChange({target:{value:'Synthetic draft'}});h.render();await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.calls.length,0);assert.ok(h.nodes().some(n=>n.props.role==='status'&&h.text(n).includes('Convert other formats before uploading')));
});
