/** Actual Edge source, synthetic auth/database and inert email transport. No network calls. */
import {execFileSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {canManageBlock} from '../lib/manager-cover.ts';import {workOrderAmount,workOrderAmountDisplay} from '../supabase/functions/_shared/work-order-amount.ts';
const raw=readFileSync(new URL('../supabase/functions/work-order-workflow/index.ts',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness({email='ramiro@aviaf.co.uk',portfolio='Ramiro Naidoo',role='manager',manager='Jillian',blockId=2,authenticated=true,compiled=js}={}){
 const sent=[],writes=[],members=[{email,role,portfolio_manager:portfolio},...[
 {email:'ramiro@aviaf.co.uk',role:'manager',portfolio_manager:'Ramiro Naidoo'},
 {email:'jillian@aviaf.co.uk',role:'manager',portfolio_manager:'Jillian'},
 {email:'other@test.invalid',role:'manager',portfolio_manager:'Other'}].filter(m=>m.email!==email)];
 const order={id:102,block_id:blockId,contractor_id:9,work_order_number:'SYNTHETIC-WO',title:'Synthetic annual cleaning',status:'Open',estimated_cost:1200,payment_status:'Not approved',is_ongoing:true,created_by:'jillian@aviaf.co.uk'};
 const submission={id:'00000000-0000-0000-0000-000000000001',dispatch_id:1,uploaded_by:'contractor@test.invalid',notification_status:'Pending'};
 const rows={work_orders:order,blocks:{id:blockId,name:'Synthetic Court',manager,address:'Example'},contractors:{id:9,company_name:'Synthetic supplier',email:'contractor@test.invalid',status:'Approved'},work_order_dispatches:{id:1,block_id:blockId,work_order_id:102,contractor_id:9,recipient_email:'contractor@test.invalid',snapshot:{number:'SYNTHETIC-WO',contractor:'Synthetic supplier'}},work_order_submissions:submission};
 const db={auth:{getUser:async()=>({data:{user:authenticated?{email,user_metadata:{role:'owner',portfolio_manager:manager}}:null},error:null})},rpc:async()=>({data:[],error:null}),from(table){let mode='select',payload,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},upsert(v){mode='upsert';payload=v;writes.push({table,mode,payload:v});return q},update(v){mode='update';payload=v;writes.push({table,mode,payload:v});return q},async maybeSingle(){if(table==='portal_members')return {data:members.find(m=>m.email===email),error:null};if(table==='work_order_dispatches')return {data:null,error:null};return {data:rows[table]??null,error:null}},async single(){return {data:table==='work_order_dispatches'&&mode==='upsert'?{id:1,...payload}:rows[table],error:null}},then(resolve){resolve({data:table==='portal_members'?members:rows[table],error:null})}};return q}};
 let handler;const Deno={serve(fn){handler=fn},env:{get:name=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SECRET_KEYS:'{"default":"synthetic"}',RESEND_API_KEY:'synthetic',RESEND_FROM_EMAIL:'noreply@test.invalid'})[name]}};
 const fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return {ok:true}};
 new Function('Deno','createClient','fetch','canManageBlock','workOrderAmount','workOrderAmountDisplay',compiled)(Deno,()=>db,fetch,canManageBlock,workOrderAmount,workOrderAmountDisplay);
 return {sent,writes,members,async invoke(event='send'){return handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(event==='notify'?{event,submissionId:submission.id}:{event,workOrderId:102})}))}};
}
test('both named managers send covered and future-portfolio work orders under their own identity',async()=>{
 for(const [email,portfolio,manager] of [['ramiro@aviaf.co.uk','Ramiro Naidoo','Jillian'],['jillian@aviaf.co.uk','Jillian','Ramiro Naidoo']])for(const blockId of [2,999]){
  const h=harness({email,portfolio,manager,blockId});assert.equal((await h.invoke()).status,200);assert.equal(h.sent.length,1);assert.equal(h.writes.find(w=>w.mode==='upsert').payload.snapshot.dispatchRequestedBy,email);assert.equal(h.writes.find(w=>w.mode==='upsert').payload.block_id,blockId);assert.equal(h.writes.find(w=>w.mode==='upsert').payload.snapshot.issuedBy,'jillian@aviaf.co.uk');assert.match(h.sent[0].html,/£1,200.00/);
 }
});
test('work-order send and notification reject unrelated, lookalike, revoked, forged-metadata and unauthenticated access',async()=>{
 const denied=[{manager:'Bobby'},{email:'lookalike@test.invalid'},{portfolio:'Other'},{role:'resident'},{role:'contractor'},{authenticated:false}];
 for(const opts of denied)for(const event of ['send','notify']){const h=harness(opts),result=await h.invoke(event);assert.equal(result.status,opts.authenticated===false?401:403);assert.equal(h.sent.length,0);assert.equal(h.writes.length,0);}
});
test('covered upload notifications reach both current authorized managers and exclude unrelated or revoked members',async()=>{
 for(const [email,portfolio,manager] of [['ramiro@aviaf.co.uk','Ramiro Naidoo','Jillian'],['jillian@aviaf.co.uk','Jillian','Ramiro Naidoo']]){
  const h=harness({email,portfolio,manager});assert.equal((await h.invoke('notify')).status,200);assert.deepEqual(h.sent.map(m=>m.to[0]).sort(),['jillian@aviaf.co.uk','ramiro@aviaf.co.uk']);
 }
 const h=harness();h.members.find(m=>m.email==='jillian@aviaf.co.uk').role='resident';assert.equal((await h.invoke('notify')).status,200);assert.deepEqual(h.sent.map(m=>m.to[0]),['ramiro@aviaf.co.uk']);
});
test('Bobby keeps admin work-order authority for every portfolio without an owner role change',async()=>{
 for(const manager of ['Jillian','Ramiro Naidoo','Bobby','Other']){const h=harness({email:'bobby@aviaf.co.uk',role:'admin',portfolio:null,manager});assert.equal((await h.invoke()).status,200);assert.equal(h.writes.find(w=>w.mode==='upsert').payload.snapshot.dispatchRequestedBy,'bobby@aviaf.co.uk');}
});

test('Edge rollback independently removes reciprocal sender access; database-only freeze cannot replace this step',async()=>{
 const original=execFileSync('git',['show','471f09f:supabase/functions/work-order-workflow/index.ts'],{encoding:'utf8'}).replace(/^import[^\n]*\n/gm,'');
 const compiled=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 for(const event of ['send','notify']){const covered=harness();assert.equal((await covered.invoke(event)).status,200);const rolledBack=harness({compiled});assert.equal((await rolledBack.invoke(event)).status,403);assert.equal(rolledBack.sent.length,0);assert.equal(rolledBack.writes.length,0);}
 const bobby=harness({compiled,email:'bobby@aviaf.co.uk',role:'admin',portfolio:null,manager:'Other'});assert.equal((await bobby.invoke()).status,200);
});
