import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('merged resident directory retains contact editing, sign-in status and archive against the same assignment',()=>{
 const source=read('app/ResidentDirectory.tsx').replace(/^import.*\n/gm,'').replace('export default function','function');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'};
 const component=new Function('React','useState','ResidentArchiveAction','ResidentSignInStatus','ResidentContactEditor',`${js};return ResidentDirectory;`)(React,initial=>[initial,()=>{}],'archive','sign-in','contact-edit');
 const resident={id:1,unitId:11,blockId:1,fullName:'Synthetic Person',email:'login@example.invalid',contactEmail:'contact@example.invalid',phone:null,contactVersion:2,signIn:{state:'never_recorded',lastSignInAt:null}};
 const props={blocks:[{id:1,name:'Synthetic Court',address:'Synthetic address'}],units:[{id:11,unitNumber:'1'}],residents:[resident],canEditContacts:true,showSignIns:true};
 const nodes=tree=>{const result=[];const walk=n=>{if(n&&typeof n==='object'){result.push(n);n.children.forEach(walk)}};walk(tree);return result};
 const rendered=nodes(component(props));assert.equal(rendered.find(n=>n.tag==='contact-edit').props.resident,resident);assert.equal(rendered.find(n=>n.tag==='archive').props.resident,resident);assert.deepEqual(rendered.find(n=>n.tag==='sign-in').props.info,resident.signIn);assert.ok(rendered.some(n=>n.tag==='small'&&n.children.includes(resident.contactEmail)));assert.equal(resident.email,'login@example.invalid');
 assert.equal(nodes(component({...props,canEditContacts:false,showSignIns:false})).some(n=>n.tag==='contact-edit'||n.tag==='sign-in'),false);
});
test('combined server page and Portal retain all three independent default-off feature gates',()=>{
 const page=read('app/page.tsx'),portal=read('app/Portal.tsx');
 for(const name of ['LONDON_CLIENT_INVOICES_ENABLED','LONDON_RESIDENT_CONTACT_EDIT_ENABLED','LONDON_RESIDENT_SIGN_INS_ENABLED'])assert.ok(page.includes(name));
 for(const prop of ['clientInvoicesEnabled','residentContactEditEnabled','residentSignInsEnabled']){assert.ok(page.includes(prop+'={'));assert.ok(portal.includes(prop+'=false'));}
 assert.match(page,/contactEmail:contacts.get\(row.id\)/);assert.match(page,/signIn:residentSignInsEnabled/);assert.match(portal,/showResidentSignIns=\{isManager&&residentSignInsEnabled\}/);assert.match(portal,/canEditResidents=\{isManager&&residentContactEditEnabled\}/);
});
test('three proposal object names do not collide, without executing any SQL',()=>{
 const objects=new Set();for(const file of ['docs/proposed-client-invoices.sql','docs/proposed-resident-contact-edit.sql','docs/proposed-resident-sign-ins.sql'])for(const [,kind,name]of read(file).matchAll(/create\s+(?:or\s+replace\s+)?(table|function|sequence|trigger)\s+([\w.]+)/gi)){const key=kind.toLowerCase()+':'+name;assert.equal(objects.has(key),false,key);objects.add(key);}
});
