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

export const MAX_STAFF_INVOICE_FILES=12;
type UploadClient={
 storage:{from:(bucket:string)=>{upload:(path:string,file:File,options:{contentType:string;upsert:false})=>PromiseLike<{error:unknown}>}};
 from:(table:string)=>{insert:(row:Record<string,string|number|null>)=>PromiseLike<{error:unknown}>};
};
export class StaffDocumentBatchError extends Error{
 savedCount:number;
 constructor(savedCount:number){super('The next upload was not confirmed. Reload and check saved documents before trying again; ask an administrator to check for an unlinked file.');this.savedCount=savedCount;}
}
/** Append-only attachments. Invoice ledger entries and settlements are deliberately separate. */
export async function uploadStaffDocumentBatch({client,files,kind,workOrderId,contractorId,isOngoing=false,makeId=()=>crypto.randomUUID()}:{client:UploadClient;files:File[];kind:StaffDocumentType;workOrderId:number;contractorId:number|null;isOngoing?:boolean;makeId?:()=>string}){
 if(!Number.isSafeInteger(workOrderId)||workOrderId<1||contractorId===null||!Number.isSafeInteger(contractorId)||contractorId<1)throw new Error('Choose an assigned work order before uploading.');
 if(!['invoice','job-card'].includes(kind)||!files.length||files.length>MAX_STAFF_INVOICE_FILES||((!isOngoing||kind!=='invoice')&&files.length!==1))throw new Error(`Choose one document, or up to ${MAX_STAFF_INVOICE_FILES} invoices for ongoing works.`);
 // Check the entire selection before starting any storage write.
 const extensions=await Promise.all(files.map(validateStaffDocument));
 let savedCount=0;
 for(let index=0;index<files.length;index++){
  const file=files[index],id=makeId(),path=`${workOrderId}/${id}/${kind}.${extensions[index]}`;
  try{
   const {error:uploadError}=await client.storage.from(STAFF_DOCUMENT_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
   if(uploadError)throw uploadError;
   const {error}=await client.from('staff_work_order_documents').insert({id,work_order_id:workOrderId,contractor_id:contractorId,document_type:kind,storage_path:path,original_name:file.name});
   if(error)throw error;
   savedCount++;
  }catch{throw new StaffDocumentBatchError(savedCount);}
 }
 return savedCount;
}
