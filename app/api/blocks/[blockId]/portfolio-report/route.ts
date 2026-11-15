import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '../../../../../lib/supabase/server';
import {GET as statementGET} from '../statement/route';
import {GET as cashflowGET} from '../cashflow/route';
import {validateReportRange} from '../../../../../lib/portfolio-reports';
import {londonDate} from '../../../../../lib/service-charges';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
/** Read only. Uses the caller's session/RLS and never invokes posting or delivery. */
export async function GET(request:NextRequest,context:{params:Promise<{blockId:string}>}){
 const blockId=Number((await context.params).blockId),kind=request.nextUrl.searchParams.get('kind'),start=request.nextUrl.searchParams.get('start')??'',end=request.nextUrl.searchParams.get('end')??'';
 try{validateReportRange(start,end,londonDate());if(!Number.isSafeInteger(blockId)||blockId<1||!['units','buildings','client'].includes(kind??''))throw Error('Choose a valid report and building.');}catch(error){return reply({error:(error as Error).message},400);}
 const client=await createClient(),{data:{user},error:authError}=await client.auth.getUser();if(authError||!user?.email)return reply({error:'Sign in required.'},401);
 const {data:member,error:memberError}=await client.from('portal_members').select('role,portfolio_manager').eq('email',user.email.toLowerCase()).maybeSingle();
 const {data:block,error:blockError}=await client.from('blocks').select('id,name,address,manager').eq('id',blockId).maybeSingle();
 if(memberError||blockError||!block||!member||!(member.role==='owner'||member.role==='admin'||member.role==='manager'&&typeof member.portfolio_manager==='string'&&member.portfolio_manager.trim()!==''&&member.portfolio_manager===block.manager))return reply({error:'Staff access to this building is required.'},403);
 const scope={id:block.id,name:block.name,address:block.address};
 try{
  if(kind==='client'){
   if(process.env.LONDON_CLIENT_INVOICES_ENABLED!=='true')return reply({error:'Client invoicing is not enabled.'},503);
   const invoices:Record<string,unknown>[]=[],seen=new Set<string>();let total:number|null=null,size=0;
   for(let offset=0;;offset+=100){
    const result=await client.from('client_invoices').select('*',{count:'exact'}).eq('block_id',blockId).order('id').range(offset,offset+99);
    if(result.error||!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count!<0||result.count!>2500||total!==null&&total!==result.count||result.data.length!==Math.min(100,Math.max(0,result.count!-offset)))throw Error('Complete client invoice data could not be verified. Refresh or narrow the building selection.');
    total=result.count;size+=new TextEncoder().encode(JSON.stringify(result.data)).length;if(size>6000000)throw Error('This building exceeds the safe export size. Request a smaller scoped export.');
    for(const row of result.data){if(row.block_id!==blockId||typeof row.id!=='string'||seen.has(row.id))throw Error('Invoice scope or completeness changed. Refresh the report.');seen.add(row.id);invoices.push(row);}
    if(invoices.length===total)break;
   }
   // Recheck the complete immutable-ID ordering and revisions, rather than trusting mutable list offsets.
   let checked=0;
   for(let offset=0;offset<Math.max(1,total??0);offset+=100){const check=await client.from('client_invoices').select('id,revision',{count:'exact'}).eq('block_id',blockId).order('id').range(offset,offset+99);if(check.error||check.count!==total||check.data?.length!==Math.min(100,total!-offset))throw Error('Invoice data changed while loading. Refresh the report.');for(const row of check.data){const original=invoices[checked++];if(original.id!==row.id||original.revision!==row.revision)throw Error('Invoice data changed while loading. Refresh the report.');}}
   return reply({kind,block:scope,retrievedAt:new Date().toISOString(),invoices});
  }
  const response=await statementGET(request,context);if(!response.ok)return response;const data=await response.json();
  let cash=[];
  if(kind==='buildings'){const bank=await cashflowGET(request,context);if(!bank.ok)return bank;const body=await bank.json();if(body.truncated||!Array.isArray(body.rows)||!Number.isSafeInteger(body.count)||body.rows.length!==body.count)throw Error('Bank cashflow is incomplete. Narrow the dates; no complete report was generated.');cash=body.rows;}
  const result={kind,block:scope,retrievedAt:new Date().toISOString(),data,cash};if(new TextEncoder().encode(JSON.stringify(result)).length>6000000)throw Error('This building exceeds the safe export size. Narrow the report dates.');return reply(result);
 }catch(error){return reply({error:error instanceof Error?error.message:'Report unavailable. No complete export was generated.'},503);}
}
