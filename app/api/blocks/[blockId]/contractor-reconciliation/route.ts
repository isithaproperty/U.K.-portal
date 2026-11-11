import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '../../../../../lib/supabase/server';
import {canManageReviewBlock} from '../../../../../lib/management-review';
import {suggestContractor} from '../../../../../lib/contractor-reconciliation';
import {londonDate} from '../../../../../lib/service-charges';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
type Context={params:Promise<{blockId:string}>};
async function access(context:Context){
 const blockId=Number((await context.params).blockId);if(!Number.isSafeInteger(blockId)||blockId<1)throw new Error('Invalid block.');
 const client=await createClient(),{data:{user}}=await client.auth.getUser();if(!user?.email)throw new Error('Sign in required.');
 const {data:member}=await client.from('portal_members').select('role,portfolio_manager').eq('email',user.email.toLowerCase()).maybeSingle();
 const {data:block}=await client.from('blocks').select('id,manager').eq('id',blockId).maybeSingle();
 if(!member||!block||!canManageReviewBlock(member,block.manager))throw new Error('Manager access to this block required.');
 return {client,blockId,member};
}
export async function GET(_request:NextRequest,context:Context){try{
 const {client,blockId,member}=await access(context);
 // Refuse truncated evidence: never propose an invoice from incomplete payment history.
 const results=await Promise.all([
  client.from('building_cashflow_rows').select('id,block_id,transaction_date,amount_pence,bank_reference,description,transaction_id,source_file',{count:'exact'}).eq('block_id',blockId).lt('amount_pence',0).order('id').limit(1000),
  client.from('work_orders').select('id,block_id,work_order_number,contractor_id,status,payment_status,actual_cost',{count:'exact'}).eq('block_id',blockId).limit(1000),
  client.from('management_review_state').select('state,revision').eq('block_id',blockId).eq('area','creditors').maybeSingle(),
  client.from('supplier_settlement_allocations').select('invoice_id,amount_pence',{count:'exact'}).eq('block_id',blockId).limit(1000),
  client.from('supplier_settlements').select('bank_transaction_id',{count:'exact'}).eq('block_id',blockId).limit(1000),
  client.from('bank_contractor_reconciliations').select('cashflow_row_id,settlement_id',{count:'exact'}).eq('block_id',blockId).limit(1000)
 ]);
 if(results.some(r=>r.error||('count' in r&&(r.count??0)>1000)))return reply({error:'Complete reconciliation evidence is unavailable or exceeds 1,000 records. No contractor suggestions can be approved; request a scoped export or install the reviewed migration.'},503);
 const [cash,orders,saved,allocations,settlements,links]=results;
 const invoices=saved.data?.state?.invoices??[];if(!Array.isArray(invoices))throw new Error('Saved creditor register is invalid.');
 return reply({revision:saved.data?.revision??0,canApprove:member.role==='owner',rows:(cash.data??[]).map(row=>({...row,settlementId:links.data?.find(l=>l.cashflow_row_id===row.id)?.settlement_id??null,suggestion:suggestContractor(row,orders.data??[],invoices,allocations.data??[],(settlements.data??[]).map(s=>s.bank_transaction_id),londonDate())}))});
 }catch(e){return reply({error:e instanceof Error?e.message:'Reconciliation unavailable.'},400);}}
export async function POST(request:NextRequest,context:Context){try{
 const {client,blockId}=await access(context);const raw=await request.text();if(raw.length>100000)throw new Error('Request too large.');const body=JSON.parse(raw);
 if(!Array.isArray(body.residents)||!Array.isArray(body.contractors)||body.residents.length+body.contractors.length<1||body.residents.length+body.contractors.length>1000)throw new Error('Select 1–1,000 transactions.');
 if(body.contractors.length&&body.confirmedEvidence!==true)throw new Error('Confirm that the bank evidence and saved invoices were checked.');
 const {data,error}=await client.rpc('approve_block_statement',{p_block_id:blockId,p_residents:body.residents,p_contractors:body.contractors,p_revision:body.revision,p_confirmed:body.confirmedEvidence===true});
 if(error)return reply({error:error.code==='42501'?'Only the owner may confirm contractor settlements.':error.code==='P0001'?error.message:'Approval not confirmed. Reload statement status before retrying; no bank transfer is made.'},409);
 return reply({result:data});
 }catch(e){return reply({error:e instanceof Error?e.message:'Approval unavailable.'},400);}}
