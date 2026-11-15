import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const code=ts.transpileModule(read('lib/resident-sign-in.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};new Function('exports',code)(exports);
const {parseResidentSignIns:parse,residentSignInLabel:label}=exports;
test('sign-in response states preserve missing data and reject malformed or duplicate rows',()=>{
 assert.equal(label(parse([{resident_id:1,state:'no_account',last_sign_in_at:null}]).get(1)),'Not available — no linked sign-in account');assert.equal(label(parse([{resident_id:1,state:'never_recorded',last_sign_in_at:null}]).get(1)),'Never recorded');assert.equal(label(undefined),'Not available');
 for(const row of [{resident_id:1,state:'signed_in',last_sign_in_at:'invalid'},{resident_id:1,state:'never_recorded',last_sign_in_at:'2026-01-01'},{resident_id:1,state:'unrecognised',last_sign_in_at:null}])assert.equal(label(parse([row]).get(1)),'Not available');
 for(const rows of [null,[{resident_id:'1'}],[{resident_id:1},{resident_id:1}]])assert.throws(()=>parse(rows));
});
test('existing sign-ins display explicit London timezone across winter and summer',()=>{
 assert.equal(label({state:'signed_in',lastSignInAt:'2026-01-01T12:00:00Z'}),'1 Jan 2026, 12:00 (London time)');assert.equal(label({state:'signed_in',lastSignInAt:'2026-07-01T12:00:00Z'}),'1 Jul 2026, 13:00 (London time)');
});
test('staff sign-in information is gated at the manager-only server page and omitted from tenant flow',()=>{
 const page=read('app/page.tsx');assert.ok(page.indexOf('if (!isManager) redirect("/tenant")')<page.indexOf("supabase.rpc('read_resident_account_sign_ins'"));assert.match(page,/process.env.LONDON_RESIDENT_SIGN_INS_ENABLED==='true'/);assert.match(page,/if\(residentSignInsEnabled\)/);assert.match(page,/allowedIds.has\(id\)/);
 for(const path of ['app/tenant/page.tsx','app/tenant/TenantPortal.tsx']){let source;try{source=read(path)}catch{continue}assert.doesNotMatch(source,/read_resident_account_sign_ins|ResidentSignInStatus|last_sign_in_at/);}
 const portal=read('app/Portal.tsx');assert.match(portal,/showResidentSignIns=\{isManager&&residentSignInsEnabled\}/);assert.match(read('app/ResidentSignInStatus.tsx'),/may include recovery/);assert.match(read('app/ResidentSignInStatus.tsx'),/does not show portal visits or session refresh/);
});
test('resident directory hides the sign-in feature by default and uses only narrow status props when enabled',()=>{
 const source=read('app/ResidentDirectory.tsx').replace(/^import.*\n/gm,'').replace('export default function','function');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
 const React={createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)}),Fragment:'fragment'};
 const component=new Function('React','useState','ResidentArchiveAction','ResidentSignInStatus',`${js};return ResidentDirectory`)(React,initial=>[initial,()=>{}],'archive','sign-in');
 const props={blocks:[{id:1,name:'Synthetic Court',address:'Synthetic address'}],units:[{id:11,unitNumber:'1'}],residents:[{id:1,unitId:11,blockId:1,fullName:'Synthetic Person',email:'person@example.invalid',phone:null,signIn:{state:'never_recorded',lastSignInAt:null}}]};
 const nodes=tree=>{const all=[];const walk=n=>{if(n&&typeof n==='object'){all.push(n);n.children.forEach(walk)}};walk(tree);return all};
 assert.equal(nodes(component(props)).some(n=>n.tag==='sign-in'),false);const items=nodes(component({...props,showSignIns:true})).filter(n=>n.tag==='sign-in');assert.equal(items.length,1);assert.deepEqual(Object.keys(items[0].props),['info']);assert.deepEqual(items[0].props.info,props.residents[0].signIn);
});
