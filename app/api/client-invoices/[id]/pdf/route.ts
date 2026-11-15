import {NextRequest} from 'next/server';
import {clientInvoiceAccess,clientInvoiceReply as reply} from '../../../../../lib/client-invoice-access';
import {clientInvoiceId,type ClientInvoiceRecord} from '../../../../../lib/client-invoices';
import {buildClientInvoicePdf} from '../../../../../lib/client-invoice-pdf';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 let id;try{id=clientInvoiceId((await params).id);}catch{return reply({error:'Invalid invoice identifier.'},400);}
 const access=await clientInvoiceAccess();if(access.response)return access.response;
 const revision=request.nextUrl.searchParams.get('revision');let invoice:ClientInvoiceRecord;
 if(revision!==null){const number=Number(revision);if(!Number.isSafeInteger(number)||number<1)return reply({error:'Choose a saved invoice revision.'},400);const {data,error}=await access.client.from('client_invoice_events').select('snapshot').eq('invoice_id',id).eq('revision',number).maybeSingle();if(error)return reply({error:'Invoice history is unavailable.'},503);if(!data)return reply({error:'Invoice revision unavailable.'},404);invoice=data.snapshot;}
 else{const {data,error}=await access.client.from('client_invoices').select('*').eq('id',id).maybeSingle();if(error)return reply({error:'Invoice storage is unavailable.'},503);if(!data)return reply({error:'Invoice unavailable.'},404);invoice=data as ClientInvoiceRecord;}
 try{const pdf=buildClientInvoicePdf(invoice);return new Response(Uint8Array.from(pdf.content),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${pdf.fileName}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Document-SHA256':pdf.sha256}});}catch(error){return reply({error:error instanceof Error?error.message:'Invoice PDF could not be generated.'},400);}
}
