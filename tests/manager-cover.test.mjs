import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {colleaguePortfolio,managerPortfolioMatches,canManageBlock} from '../lib/manager-cover.ts';
test('reciprocal cover requires each exact named membership, current manager role and current home assignment',()=>{
 for(const [email,own,other] of [['ramiro@aviaf.co.uk','Ramiro Naidoo','Jillian'],['jillian@aviaf.co.uk','Jillian','Ramiro Naidoo']]){
  assert.equal(colleaguePortfolio(email,own),other);
  assert.equal(canManageBlock({email,role:'manager',portfolio_manager:own},other),true);
  for(const target of ['Bobby','Other','', ' '])assert.equal(canManageBlock({email,role:'manager',portfolio_manager:own},target),false);
  for(const role of ['resident','contractor','unknown'])assert.equal(canManageBlock({email,role,portfolio_manager:own},other),false);
  assert.equal(canManageBlock({email,role:'manager',portfolio_manager:'Other'},other),false);
  assert.equal(canManageBlock({email:'lookalike@test.invalid',role:'manager',portfolio_manager:own},other),false);
 }
 assert.equal(canManageBlock({email:'bobby@aviaf.co.uk',role:'admin',portfolio_manager:null},'Other'),true);
 assert.equal(managerPortfolioMatches('ramiro@aviaf.co.uk',' ',' '),false);
 assert.equal(canManageBlock(null,'Jillian'),false);
});
const raw=readFileSync(new URL('../app/Portal.tsx',import.meta.url),'utf8').replace(/^import.*\n/gm,'').replace('export default function','function');
const js=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function harness({role='manager',email='ramiro@aviaf.co.uk',portfolio='Ramiro Naidoo'}={}){
 const state=[];let cursor=0,tree,dynamicIndex=0;
 const deps={React:{createElement:(tag,props,...children)=>({tag,props:props??{},children:children.flat(Infinity)})},useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=v]},dynamic:()=>`dynamic${++dynamicIndex}`,colleaguePortfolio,dashboardLogo:'logo',Image:'Image',BlockRegister:'BlockRegister',UnitRegister:'UnitRegister',ServiceChargeRegister:'ServiceChargeRegister',TenantRequestRegister:'TenantRequestRegister',BlockDashboard:'BlockDashboard',ContractorRegister:'ContractorRegister',WorkOrderRegister:'WorkOrderRegister',BuildingSafetyRegister:'BuildingSafetyRegister',ManagementAlerts:'ManagementAlerts',CommunicationRegister:'CommunicationRegister'};
 const component=new Function(...Object.keys(deps),`${js};return Portal`)(...Object.values(deps));
 const props={serviceCharges:[{unit_id:11,amount_pence:100},{unit_id:22,amount_pence:200}],today:'2026-11-17',tenantRequests:[{block_id:1},{block_id:2}],blocks:[{id:1,manager:'Ramiro Naidoo'},{id:2,manager:'Jillian'},{id:3,manager:'Bobby'}],units:[{id:11,blockId:1},{id:22,blockId:2}],residents:[{id:1,unitId:11,blockId:1},{id:2,unitId:22,blockId:2}],workOrders:[{id:101,blockId:1},{id:102,blockId:2}],contractors:[],contractorDocuments:[],buildingSafetyRecords:[{blockId:1},{blockId:2}],isManager:true,memberRole:role,portfolioManager:portfolio,viewerEmail:email,clientInvoicesEnabled:true};
 function render(){cursor=0;tree=component(props);return tree;}
 const nodes=()=>{const out=[];function walk(n){if(n&&typeof n==='object'){out.push(n);n.children?.forEach(walk)}}walk(tree);return out;};
 const text=n=>typeof n==='string'?n:typeof n==='number'?String(n):(n?.children??[]).map(text).join('');
 const button=label=>nodes().find(n=>n.tag==='button'&&text(n)===label);
 const child=tag=>nodes().find(n=>n.tag===tag);
 const click=label=>{const b=button(label);assert.ok(b,label);b.props.onClick();render();};render();return {button,child,click,nodes};
}
test('own and colleague tabs scope each feature and reset open forms, without changing actor or approvals',()=>{
 const h=harness();h.click('▦Buildings');assert.deepEqual(h.child('BlockRegister').props.blocks.map(b=>b.id),[1]);
 assert.equal(h.button('My blocks').props['aria-pressed'],true);h.click('Jillian’s blocks');assert.deepEqual(h.child('BlockRegister').props.blocks.map(b=>b.id),[2]);assert.equal(h.button('Jillian’s blocks').props['aria-pressed'],true);
 assert.equal(h.nodes().find(n=>n.props.className==='content').props.key,'cover');
 h.click('◎Units & residents');assert.deepEqual(h.child('UnitRegister').props.residents.map(r=>r.id),[2]);assert.deepEqual(h.child('UnitRegister').props.units.map(u=>u.id),[22]);
 h.click('⌁Work orders');assert.deepEqual(h.child('WorkOrderRegister').props.workOrders.map(w=>w.id),[102]);assert.equal(h.child('WorkOrderRegister').props.viewerEmail,'ramiro@aviaf.co.uk');assert.equal(h.child('WorkOrderRegister').props.memberRole,'manager');assert.deepEqual(h.child('TenantRequestRegister').props.requests,[{block_id:2}]);
 h.click('◇Health & Safety');assert.deepEqual(h.child('BuildingSafetyRegister').props.records,[{blockId:2}]);
 h.click('£Service charges');assert.deepEqual(h.child('ServiceChargeRegister').props.entries.map(c=>c.unit_id),[22]);
 h.click('▤Statements & summaries');assert.deepEqual(h.child('dynamic1').props.blocks.map(b=>b.id),[2]);
 h.click('£Client invoices');assert.equal(h.child('dynamic3').props.canApprove,false);assert.deepEqual(h.child('dynamic3').props.blocks.map(b=>b.id),[2]);
 h.click('◇Management review');assert.equal(h.child('dynamic2').props.canRecordSettlements,false);
 h.click('My blocks');assert.deepEqual(h.child('BlockRegister').props.blocks.map(b=>b.id),[1]);assert.equal(h.nodes().find(n=>n.props.className==='content').props.key,'own');
});
test('Jillian receives reciprocal tab; Bobby and unrelated managers have no cover switch',()=>{
 const j=harness({email:'jillian@aviaf.co.uk',portfolio:'Jillian'});j.click('Ramiro’s blocks');assert.deepEqual(j.child('BlockRegister').props.blocks.map(b=>b.id),[1]);
 for(const opts of [{role:'admin',email:'bobby@aviaf.co.uk',portfolio:null},{email:'other@test.invalid',portfolio:'Other'}]){const h=harness(opts);assert.equal(h.button('Jillian’s blocks'),undefined);assert.equal(h.button('Ramiro’s blocks'),undefined);}
});
