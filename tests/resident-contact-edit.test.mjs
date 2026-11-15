import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const model=ts.transpileModule(read('lib/resident-contact-edit.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};new Function('exports',model)(exports);const {validateResidentContactEdit:validate}=exports;
const body={expectedVersion:2,fullName:' Alice ',contactEmail:' NEW@Example.invalid ',phone:' 123 '};
test('contact validation normalizes contacts and rejects identity/ownership changes',()=>{
 assert.deepEqual(validate(body),{expectedVersion:2,fullName:'Alice',contactEmail:'new@example.invalid',phone:'123'});
 for(const key of ['email','unitId','blockId','id','archivedAt'])assert.throws(()=>validate({...body,[key]:99}));
 for(const changes of [{expectedVersion:0},{expectedVersion:1.2},{fullName:'\u2000\u00a0'},{fullName:'x\ny'},{contactEmail:'a b@x.invalid'},{contactEmail:'x@invalid'},{phone:'x'.repeat(81)}])assert.throws(()=>validate({...body,...changes}));
});
function api({member={role:'manager',portfolio_manager:'London'},manager='London',rpcError=null,historyError=null,auth=true}={}){
 let calls=[];const client={auth:{getUser:async()=>({data:{user:auth?{email:'manager@example.invalid'}:null}})},from(table){const query={select(){return query},eq(){return query},order(){return query},limit(){return query},lt(){return query},maybeSingle:async()=>({data:table==='portal_members'?member:table==='blocks'?{manager}:{id:1,contact_version:2}}),then(resolve){return Promise.resolve({data:[],count:0,error:historyError}).then(resolve)}};return query},rpc:async(name,args)=>{calls.push({name,args});return {data:rpcError?null:{resident:{id:1,email:'old@example.invalid'},changed:true},error:rpcError}}};
 const code=ts.transpileModule(read('app/api/blocks/[blockId]/residents/[residentId]/route.ts').replace(/^import.*\n/gm,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,output={};
 new Function('exports','NextResponse','createClient','canManageReviewBlock','validateResidentContactEdit',code)(output,{json:(body,{status})=>({body,status})},async()=>client,(m,b)=>m&&(m.role==='owner'||m.role==='admin'||m.role==='manager'&&m.portfolio_manager===b),validate);
 const req={headers:new Headers({origin:'https://portal.invalid'}),nextUrl:new URL('https://portal.invalid/api/resident'),text:async()=>JSON.stringify(body)},ctx={params:Promise.resolve({blockId:'1',residentId:'1'})};return {output,req,ctx,calls};
}
test('API fails closed before activation and for missing identity, scope and foreign origin',async()=>{
 const previous=process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED;try{
 delete process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED;let h=api();assert.equal((await h.output.PATCH(h.req,h.ctx)).status,503);assert.equal(h.calls.length,0);
 process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED='true';for(const [opts,status] of [[{auth:false},401],[{member:{role:'resident'}},403],[{manager:'Other'},403]]){h=api(opts);assert.equal((await h.output.PATCH(h.req,h.ctx)).status,status);assert.equal(h.calls.length,0);}
 h=api();h.req.headers.set('origin','https://other.invalid');assert.equal((await h.output.PATCH(h.req,h.ctx)).status,403);
 }finally{if(previous===undefined)delete process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED;else process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED=previous;}
});
test('API only calls versioned contact RPC, distinguishes conflicts and unknown saves, verifies history',async()=>{
 const previous=process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED;process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED='true';try{
 let h=api(),result=await h.output.PATCH(h.req,h.ctx);assert.equal(result.status,200);assert.equal(result.body.loginIdentityChanged,false);assert.deepEqual(h.calls,[{name:'update_resident_contact',args:{p_block_id:1,p_resident_id:1,p_expected_version:2,p_full_name:'Alice',p_contact_email:'new@example.invalid',p_phone:'123'}}]);
 for(const [code,status,uncertain] of [['40001',409,false],['PGRST202',503,false],['NETWORK',503,true]]){h=api({rpcError:{code}});result=await h.output.PATCH(h.req,h.ctx);assert.equal(result.status,status);assert.equal(result.body.uncertain,uncertain);}
 h=api({historyError:{code:'missing'}});assert.equal((await h.output.GET(h.req,h.ctx)).status,503);
 }finally{if(previous===undefined)delete process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED;else process.env.LONDON_RESIDENT_CONTACT_EDIT_ENABLED=previous;}
});
function editor(responses){
 const code=ts.transpileModule(read('app/ResidentContactEditor.tsx').replace(/^import.*\n/gm,'').replace('export default function','function'),{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 let cursor=0,tree;const state=[],requests=[];
 const useState=initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>state[i]=typeof value==='function'?value(state[i]):value]};
 const useRef=initial=>{const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i]};
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'};
 const fetch=async(url,options)=>{requests.push({url,options});const response=responses.shift();if(response instanceof Error)throw response;return {ok:response.status===200,status:response.status,json:async()=>response.body}};
 const component=new Function('React','useState','useRef','useRouter','fetch',`${code};return ResidentContactEditor`)(React,useState,useRef,()=>({refresh(){}}),fetch);
 const render=()=>{cursor=0;tree=component({resident:{id:1,blockId:1,fullName:'Alice'}})};
 const nodes=()=>{const out=[];function walk(n){if(n&&typeof n==='object'){out.push(n);n.children.forEach(walk)}}walk(tree);return out};const text=n=>typeof n==='string'?n:typeof n==='number'?String(n):(n?.children??[]).map(text).join('');
 const button=label=>nodes().find(n=>n.tag==='button'&&text(n)===label);render();return {render,nodes,button,requests,text};
}
const saved={id:1,full_name:'Latest Alice',email:'sign-in@test.invalid',contact_email:null,contact_version:7,phone:'123',archived_at:null};
const loaded={status:200,body:{resident:saved,history:[],historyCount:0}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('editor loads current version and blocks duplicate or uncertain retries until verified reload',async()=>{
 const h=editor([loaded,new Error('network interrupted'),loaded]);h.button('Edit contact details').props.onClick();await flush();h.render();
 assert.equal(h.nodes().find(n=>n.tag==='input').props.value,'Latest Alice');assert.ok(h.nodes().some(n=>h.text(n).includes('sign-in@test.invalid')));
 let form=h.nodes().find(n=>n.tag==='form');const first=form.props.onSubmit({preventDefault(){}});await form.props.onSubmit({preventDefault(){}});await first;h.render();assert.equal(h.requests.length,2);assert.equal(h.nodes().find(n=>n.tag==='fieldset').props.disabled,true);
 const payload=JSON.parse(h.requests[1].options.body);assert.equal(payload.expectedVersion,7);assert.equal(payload.contactEmail,'sign-in@test.invalid');assert.equal('email' in payload,false);
 await h.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(h.requests.length,2);
 await h.button('Reload saved details').props.onClick();await flush();h.render();assert.equal(h.nodes().find(n=>n.tag==='fieldset').props.disabled,false);
});
test('editor cannot save when current details or audit history fail to load',async()=>{
 const h=editor([{status:503,body:{error:'Audit unavailable'}}]);h.button('Edit contact details').props.onClick();await flush();h.render();assert.equal(h.nodes().some(n=>n.tag==='form'),false);assert.equal(h.requests.length,1);
});
