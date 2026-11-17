import {NextResponse} from 'next/server';
import {createClient} from './supabase/server';
import {canManageReviewBlock} from './management-review';
export const clientInvoiceReply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function clientInvoiceAccess(blockId?:number){
 if(process.env.LONDON_CLIENT_INVOICES_ENABLED!=='true')return {response:clientInvoiceReply({error:'Client invoicing has not been activated.'},503)};
 const client=await createClient(),{data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user?.email)return {response:clientInvoiceReply({error:'Sign in required.'},401)};
 const {data:member,error:memberError}=await client.from('portal_members').select('email,role,portfolio_manager').eq('email',user.email.toLowerCase()).maybeSingle();
 if(memberError||!member||!['owner','admin','manager'].includes(member.role))return {response:clientInvoiceReply({error:'Management access required.'},403)};
 if(blockId!==undefined){
  if(!Number.isSafeInteger(blockId)||blockId<1)return {response:clientInvoiceReply({error:'Choose a valid block.'},400)};
  const {data:block,error}=await client.from('blocks').select('manager').eq('id',blockId).maybeSingle();
  if(error||!block||!canManageReviewBlock(member,block.manager))return {response:clientInvoiceReply({error:'Manager block access required.'},403)};
 }
 return {client,member};
}

export const clientInvoiceIssuingEnabled=()=>process.env.LONDON_CLIENT_INVOICE_ISSUING_ENABLED==='true';
