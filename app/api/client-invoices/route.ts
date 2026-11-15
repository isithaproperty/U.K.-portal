import {NextRequest} from 'next/server';
import {clientInvoiceAccess,clientInvoiceReply as reply} from '../../../lib/client-invoice-access';
import {CLIENT_INVOICE_PAGE_SIZE,validateClientInvoiceRequest,type ClientInvoiceRecord} from '../../../lib/client-invoices';
import {buildClientInvoicePdf} from '../../../lib/client-invoice-pdf';
import {londonDate} from '../../../lib/service-charges';
export async function GET(request:NextRequest){
 const blockId=Number(request.nextUrl.searchParams.get('blockId')),page=Number(request.nextUrl.searchParams.get('page')??0);
 if(!Number.isSafeInteger(page)||page<0||page>10000)return reply({error:'Choose a valid invoice page.'},400);
 const access=await clientInvoiceAccess(blockId);if(access.response)return access.response;
 const {data,error,count}=await access.client.from('client_invoices').select('*',{count:'exact'}).eq('block_id',blockId).order('updated_at',{ascending:false}).order('id').range(page*CLIENT_INVOICE_PAGE_SIZE,(page+1)*CLIENT_INVOICE_PAGE_SIZE-1);
 if(error||count===null)return reply({error:'Client invoice storage is unavailable. Install the reviewed additive migration before activation.'},503);
 return reply({invoices:data,total:count,page,pageSize:CLIENT_INVOICE_PAGE_SIZE});
}
/** Only the dedicated client-invoice RPC is called; no resident/supplier posting or delivery exists here. */
export async function POST(request:NextRequest){
 const origin=request.headers.get('origin');if(origin&&origin!==request.nextUrl.origin)return reply({error:'Same-origin request required.'},403);
 let body;
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>110000)throw Error('Invoice request is too large.');body=validateClientInvoiceRequest(JSON.parse(raw));}catch(error){return reply({error:error instanceof Error?error.message:'Invalid invoice request.'},400);}
 const access=await clientInvoiceAccess(body.blockId);if(access.response)return access.response;
 if(body.action!=='Save'&&!['owner','admin'].includes(access.member.role))return reply({error:'Only an owner or admin may review, issue or void client invoices.'},403);
 if(['Review','Issue'].includes(body.action)){
  const {data:saved,error}=await access.client.from('client_invoices').select('*').eq('id',body.id).eq('block_id',body.blockId).maybeSingle();
  if(error)return reply({error:'Saved client invoices could not be read.'},503);if(!saved)return reply({error:'Saved invoice unavailable.'},404);
  try{buildClientInvoicePdf({...saved,status:'Reviewed'} as ClientInvoiceRecord);if(body.action==='Issue'&&saved.document.invoiceDate>londonDate())throw Error('Future-dated invoices cannot be issued yet.');}catch(error){return reply({error:error instanceof Error?error.message:'Invoice PDF failed validation.'},400);}
 }
 const {data,error}=await access.client.rpc('mutate_client_invoice',{p_request:body});
 if(error){const code=error.code??'';if(code==='42501')return reply({error:'Owner/admin confirmation or portfolio access is required.'},403);if(code==='40001'||code==='23505')return reply({error:error.message,uncertain:false},409);if(code==='P0001'||code.startsWith('22'))return reply({error:error.message,uncertain:false},400);if(['42P01','42883','PGRST202','PGRST205'].includes(code))return reply({error:'The reviewed client-invoice migration is not installed. No action was performed.',uncertain:false},503);return reply({error:'Invoice action was not confirmed. Reload audit history before retrying the same request.',uncertain:true},503);}
 if(!data?.invoice?.id)return reply({error:'Invoice action returned no confirmed record. Inspect saved history before retrying.',uncertain:true},503);
 return reply({...data,emailSent:false,ledgerChanged:false});
}
