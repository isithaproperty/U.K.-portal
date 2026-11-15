/** Standalone management-company sales invoices. No resident or supplier ledger inputs. */
export type ClientInvoiceLine={id:string;description:string;quantityMilli:number;unitPricePence:number;vatRateBps:number};
export type ClientInvoiceDocument={version:1;currency:'GBP';issuer:{name:string;address:string;email:string;companyNumber:string;vatRegistered:boolean;vatNumber:string};client:{name:string;address:string;email:string};periodStart:string;periodEnd:string;invoiceDate:string;dueDate:string;reference:string;paymentInstructions:string;notes:string;lines:ClientInvoiceLine[]};
export type ClientInvoiceRecord={id:string;block_id:number;block_snapshot:{name:string;address:string};status:'Draft'|'Reviewed'|'Issued'|'Voided';invoice_number:string|null;revision:number;document:ClientInvoiceDocument;net_pence:number;vat_pence:number;total_pence:number;created_by:string;created_at:string;updated_by:string;updated_at:string;reviewed_by:string|null;reviewed_at:string|null;issued_by:string|null;issued_at:string|null;voided_by:string|null;voided_at:string|null;void_reason:string|null};
export type ClientInvoiceAction='Save'|'Review'|'Issue'|'Void';
export type ClientInvoiceRequest={requestId:string;id:string;blockId:number;expectedRevision:number;action:ClientInvoiceAction;document?:ClientInvoiceDocument;confirmed?:true;reason?:string};
export type ClientInvoiceEvent={revision:number;action:ClientInvoiceAction;actor:string;actor_id:string;occurred_at:string;request_id:string;snapshot:ClientInvoiceRecord};
export const CLIENT_INVOICE_PAGE_SIZE=25;
export const CLIENT_INVOICE_LIMIT=1_000_000_000_000;
export function clientInvoiceId(value:unknown){if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw Error('Use a valid invoice or request UUID.');return value.toLowerCase();}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid client invoice document.');return value as Record<string,unknown>;}
function text(value:unknown,max:number,required=false){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||required&&!value.trim())throw Error('Complete the invoice labels within their length limits.');return value.trim();}
function integer(value:unknown,max:number){if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>max)throw Error('Invoice quantities, prices and VAT rates must be nonnegative whole accounting units within their limits.');return value as number;}
function date(value:unknown,required:boolean){const s=text(value,10,required);if(s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(`${s}T12:00:00Z`).toISOString().slice(0,10)!==s))throw Error('Use valid YYYY-MM-DD invoice dates.');return s;}
function email(value:unknown){const s=text(value,200);if(s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw Error('Enter a valid contact email or leave it blank.');return s;}
const winAnsiExtra='€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function clientInvoicePdfText(value:string){for(const c of value){const n=c.codePointAt(0)!;if(!([9,10,13].includes(n)||n>=32&&n<=126||n>=160&&n<=255||winAnsiExtra.includes(c)))throw Error('This PDF supports Western European text. Review unsupported characters before issuing.');}return value;}
export function validateClientInvoiceDocument(value:unknown,ready=false):ClientInvoiceDocument{
 const raw=record(value),issuer=record(raw.issuer),client=record(raw.client);
 if(raw.version!==1||raw.currency!=='GBP'||typeof issuer.vatRegistered!=='boolean'||!Array.isArray(raw.lines)||raw.lines.length>50||ready&&!raw.lines.length)throw Error('Use GBP, an explicit VAT registration setting and up to 50 invoice lines.');
 const doc:ClientInvoiceDocument={version:1,currency:'GBP',issuer:{name:text(issuer.name,200,ready),address:text(issuer.address,1000,ready),email:email(issuer.email),companyNumber:text(issuer.companyNumber,100),vatRegistered:issuer.vatRegistered,vatNumber:text(issuer.vatNumber,100,ready&&issuer.vatRegistered)},client:{name:text(client.name,200,ready),address:text(client.address,1000,ready),email:email(client.email)},periodStart:date(raw.periodStart,ready),periodEnd:date(raw.periodEnd,ready),invoiceDate:date(raw.invoiceDate,ready),dueDate:date(raw.dueDate,ready),reference:text(raw.reference,200),paymentInstructions:text(raw.paymentInstructions,2000),notes:text(raw.notes,2000),lines:raw.lines.map(value=>{const line=record(value);const result={id:clientInvoiceId(line.id),description:text(line.description,500,ready),quantityMilli:integer(line.quantityMilli,1_000_000),unitPricePence:integer(line.unitPricePence,100_000_000),vatRateBps:integer(line.vatRateBps,10000)};if(ready&&(!result.quantityMilli||!result.unitPricePence))throw Error('Reviewed invoice lines need positive quantities and prices.');if(!issuer.vatRegistered&&result.vatRateBps!==0)throw Error('VAT cannot be charged unless the issuer is explicitly configured as VAT registered.');return result;})};
 if(new Set(doc.lines.map(line=>line.id)).size!==doc.lines.length)throw Error('Invoice line identifiers must be unique.');
 if(!doc.issuer.vatRegistered&&doc.issuer.vatNumber)throw Error('Remove the VAT number when VAT registration is off.');
 if(doc.periodStart&&doc.periodEnd&&doc.periodEnd<doc.periodStart||doc.invoiceDate&&doc.dueDate&&doc.dueDate<doc.invoiceDate)throw Error('Billing period and due dates must be in order.');
 const total=clientInvoiceTotals(doc);if(ready&&total.totalPence<=0)throw Error('A reviewed invoice must have a positive total.');
 if(ready){for(const s of [...Object.values(doc.issuer).filter(v=>typeof v==='string'),...Object.values(doc.client),doc.reference,doc.paymentInstructions,doc.notes,...doc.lines.map(l=>l.description)])clientInvoicePdfText(s as string);}
 return doc;
}
export function clientInvoiceTotals(doc:ClientInvoiceDocument){
 const lines=doc.lines.map(line=>{const netPence=Number((BigInt(line.quantityMilli)*BigInt(line.unitPricePence)+500n)/1000n);const vatPence=Number((BigInt(netPence)*BigInt(line.vatRateBps)+5000n)/10000n);return {...line,netPence,vatPence,totalPence:netPence+vatPence};});
 const netPence=lines.reduce((s,l)=>s+l.netPence,0),vatPence=lines.reduce((s,l)=>s+l.vatPence,0),totalPence=netPence+vatPence;
 if(!Number.isSafeInteger(totalPence)||totalPence>CLIENT_INVOICE_LIMIT)throw Error('Invoice exceeds the supported total.');
 return {lines,netPence,vatPence,totalPence};
}
export function validateClientInvoiceRequest(value:unknown):ClientInvoiceRequest{
 const raw=record(value);if(!Number.isSafeInteger(raw.blockId)||(raw.blockId as number)<1||!Number.isSafeInteger(raw.expectedRevision)||(raw.expectedRevision as number)<0||!['Save','Review','Issue','Void'].includes(raw.action as string))throw Error('Choose a block, saved revision and invoice action.');
 const result:ClientInvoiceRequest={requestId:clientInvoiceId(raw.requestId),id:clientInvoiceId(raw.id),blockId:raw.blockId as number,expectedRevision:raw.expectedRevision as number,action:raw.action as ClientInvoiceAction};
 if(result.action==='Save')result.document=validateClientInvoiceDocument(raw.document);
 else{if(raw.confirmed!==true)throw Error('Explicit confirmation of this saved invoice revision is required.');result.confirmed=true;if(result.action==='Void'){result.reason=text(raw.reason,1000,true);if(result.reason.length<5)throw Error('Record a clear reason for voiding.');clientInvoicePdfText(result.reason);}}
 return result;
}
export function blankClientInvoice(today:string):ClientInvoiceDocument{return {version:1,currency:'GBP',issuer:{name:'',address:'',email:'',companyNumber:'',vatRegistered:false,vatNumber:''},client:{name:'',address:'',email:''},periodStart:today,periodEnd:today,invoiceDate:today,dueDate:today,reference:'',paymentInstructions:'',notes:'',lines:[]};}
export function clientInvoiceDecimal(value:string,places:number,max:number){
 if(value==='')return 0;
 if(!new RegExp(`^[0-9]+(?:\\.[0-9]{0,${places}})?$`).test(value))throw Error(`Use a nonnegative amount with up to ${places} decimal places.`);
 const [whole,fraction='']=value.split('.'),result=Number(whole)*10**places+Number(fraction.padEnd(places,'0'));
 if(!Number.isSafeInteger(result)||result>max)throw Error('Amount exceeds the supported limit.');return result;
}
