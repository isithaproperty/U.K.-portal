/** Start tests/helpers/mock-supabase.mjs and local Next with its documented test env first. */
import assert from 'node:assert/strict';
import {prepareFinancialDraft} from '../lib/financial-planning.ts';
const base=process.env.REVIEW_TEST_URL??'http://127.0.0.1:3010';
function cookie(email){const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const access_token=`${b({alg:'HS256',typ:'JWT'})}.${b({sub:'00000000-0000-0000-0000-000000000001',email,role:'authenticated',aud:'authenticated',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.synthetic-test-signature`;return `sb-127-auth-token=base64-${b({access_token,refresh_token:'local-test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:'00000000-0000-0000-0000-000000000001',email}})}`;}
async function request(path,{email='manager@example.invalid',method='GET',body}={}){const response=await fetch(base+path,{method,headers:{...(email?{Cookie:cookie(email)}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();return {status:response.status,data};}
const debtor='/api/blocks/1/management-review/debtors';
assert.equal((await request(debtor,{email:null})).status,401);
assert.equal((await request(debtor,{email:'tenant@example.invalid'})).status,403);
assert.equal((await request(debtor,{email:'other@example.invalid'})).status,403);
assert.equal((await request('/api/blocks/1/management-review/unknown')).status,400);
const initial=await request(debtor);assert.equal(initial.status,200,JSON.stringify(initial));
const notes={notes:{10:'Manager account note'},history:[],mode:'Payment allocation review',receipt:''};
const save=await request(debtor,{method:'PUT',body:{state:notes,revision:initial.data.revision}});assert.equal(save.status,200,JSON.stringify(save));assert.equal(save.data.revision,initial.data.revision+1);
assert.deepEqual((await request(debtor)).data.state,notes);
assert.equal((await request(debtor,{method:'PUT',body:{state:notes,revision:initial.data.revision}})).status,409);
assert.equal((await request(debtor,{method:'PUT',body:{state:{...notes,notes:{999:'Foreign unit'}},revision:save.data.revision}})).status,400);
const input={batchId:'local-api-batch-1',blockId:1,kind:'Demand',preparedDate:'2026-11-02',issueDate:'2026-11-02',dueDate:'2026-12-25',issueMode:'Issue now, future due date',frequency:'Annual',yearStart:'2026-11-02',periodIndex:0,schedules:[{id:'main',name:'Lease main schedule',annualPence:10000,shares:[{unitId:10,percentage:'100'}]}]};
const state={version:1,blockId:1,kind:input.kind,schedules:[{id:'main',name:'Lease main schedule',amount:'100',percentages:{10:'100'}}],frequency:input.frequency,yearStart:input.yearStart,periodIndex:0,issueMode:input.issueMode,issueDate:input.issueDate,dueDate:input.dueDate,prepared:{input,rows:prepareFinancialDraft(input)}};
const financial='/api/blocks/1/management-review/financials';const loaded=await request(financial);const prepared=await request(financial,{method:'PUT',body:{state,revision:loaded.data.revision}});assert.equal(prepared.status,200,JSON.stringify(prepared));
const post='/api/blocks/1/financial-batches',approval={approved:true,batchId:input.batchId,revision:prepared.data.revision};
assert.equal((await request(post,{email:'other@example.invalid',method:'POST',body:approval})).status,403);
assert.equal((await request(post,{method:'POST',body:{...approval,approved:false}})).status,400);
assert.equal((await request(post,{method:'POST',body:{...approval,revision:approval.revision+1}})).status,409);
const posted=await request(post,{method:'POST',body:approval});assert.equal(posted.status,200,JSON.stringify(posted));assert.equal(posted.data.imported,1);assert.equal(posted.data.emailSent,false);
const replay=await request(post,{method:'POST',body:approval});assert.deepEqual(replay,posted);
console.log('PASS: actual Next handlers via local mocked Supabase transport: auth, portfolio scope, read/save/reload, revision conflict, foreign-unit rejection, approval gate and idempotent ledger replay. No production services used.');
