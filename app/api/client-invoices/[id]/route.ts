import {clientInvoiceAccess,clientInvoiceReply as reply} from '../../../../lib/client-invoice-access';
import {clientInvoiceId} from '../../../../lib/client-invoices';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 let id;try{id=clientInvoiceId((await params).id);}catch{return reply({error:'Invalid invoice identifier.'},400);}
 const beforeRaw=new URL(_request.url).searchParams.get('beforeRevision'),before=beforeRaw===null?null:Number(beforeRaw);
 if(before!==null&&(!Number.isSafeInteger(before)||before<1))return reply({error:'Choose a valid history revision.'},400);
 const access=await clientInvoiceAccess();if(access.response)return access.response;
 const {data:invoice,error}=await access.client.from('client_invoices').select('*').eq('id',id).maybeSingle();
 if(error)return reply({error:'Client invoice storage is unavailable.'},503);if(!invoice)return reply({error:'Invoice unavailable.'},404);
 let query=access.client.from('client_invoice_events').select('revision,action,actor,actor_id,occurred_at,request_id,snapshot',{count:'exact'}).eq('invoice_id',id).order('revision',{ascending:false}).limit(20);
 if(before!==null)query=query.lt('revision',before);
 const {data:history,error:historyError,count}=await query;
 if(historyError||count===null)return reply({error:'Invoice audit history could not be verified.'},503);
 return reply({invoice,history,historyCount:count});
}
