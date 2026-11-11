export const STAFF_DOCUMENT_BUCKET='staff-work-order-documents';
export type StaffDocumentType='invoice'|'job-card';
export function staffDocumentExtension(file:{type:string;size:number;name:string}) {
 const extension=({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'} as Record<string,string>)[file.type];
 if(!extension||!Number.isSafeInteger(file.size)||file.size<1||file.size>10485760)throw new Error('Choose a PDF, JPG or PNG between 1 byte and 10 MB.');
 if(!file.name.trim()||file.name.length>200)throw new Error('The filename must contain 1–200 characters. Rename the file and try again.');
 return extension;
}
export async function validateStaffDocument(file:File){
 const extension=staffDocumentExtension(file), bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
 const matches=extension==='pdf'?String.fromCharCode(...bytes.slice(0,5))==='%PDF-':extension==='jpg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
 if(!matches)throw new Error('The file contents do not match its PDF, JPG or PNG type.');
 return extension;
}
