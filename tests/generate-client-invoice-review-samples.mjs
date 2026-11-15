/** Local synthetic PDF fixtures only. No database, Auth, email or network calls. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {invoiceDocument,invoiceRecord} from './fixtures/client-invoices.mjs';
import {buildClientInvoicePdf} from '../lib/client-invoice-pdf.ts';
const output=resolve(process.argv[2]??'/tmp/london-client-invoice-review-updated');await mkdir(output,{recursive:true});
for(const vat of [false,true]){
 const document=invoiceDocument();document.invoiceType=vat?'vat':'non-vat';document.invoiceDate='2026-02-02';document.dueDate='2026-02-28';document.supplyDate='2026-01-31';document.vatTaxPoint=vat?'2026-01-31':'';
 document.notes='SYNTHETIC SAMPLE ONLY - NOT A REAL INVOICE. No production record or invoice number was allocated. No cash discount or special VAT scheme.';
 document.issuer={...document.issuer,email:vat?'issuer@example.invalid':'',phone:vat?'':'+44 (0)20 1234 5678',vatRegistered:vat,vatNumber:vat?'SYNTHETIC-NOT-A-VALID-VAT-NUMBER':''};document.lines[0].vatRateBps=vat?2000:0;
 const row=invoiceRecord({document,status:'Issued',invoice_number:vat?'MCI-99999992':'MCI-99999991',issued_at:'2026-02-02T12:00:00Z'}),pdf=buildClientInvoicePdf(row),name=vat?'hypothetical-vat-sample':'non-vat-phone-contact-sample';
 await writeFile(resolve(output,`${name}.pdf`),pdf.content);await writeFile(resolve(output,`${name}.txt`),pdf.text);console.log(`${name}: ${pdf.sha256}`);
}
