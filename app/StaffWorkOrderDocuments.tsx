'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '../lib/supabase/browser';
import {STAFF_DOCUMENT_BUCKET,uploadStaffDocumentBatch,StaffDocumentBatchError,MAX_STAFF_INVOICE_FILES,type StaffDocumentType} from '../lib/staff-work-order-documents';
export type StaffWODocument={id:string;document_type:StaffDocumentType;storage_path:string;original_name:string;uploaded_by_email:string;uploaded_at:string};
export default function StaffWorkOrderDocuments({workOrderId,workOrderNumber,contractorName,contractorId,manager,canUpload,documents,loadError,isOngoing=false}:{isOngoing?:boolean;workOrderId:number;workOrderNumber:string;contractorName:string;contractorId:number|null;manager:boolean;canUpload:boolean;documents:StaffWODocument[];loadError:boolean}){
 const router=useRouter(),lock=useRef(false),form=useRef<HTMLFormElement>(null);
 const [kind,setKind]=useState<StaffDocumentType>('invoice'),[files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[uncertain,setUncertain]=useState(false);
 async function upload(event:React.FormEvent){
  event.preventDefault();if(lock.current||!files.length||!canUpload||uncertain||loadError)return;
  lock.current=true;setBusy(true);setMessage('');
  try{
   const client=createClient();
   const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)throw new Error('Sign in again before uploading.');
   const saved=await uploadStaffDocumentBatch({client,files,kind,workOrderId,contractorId,isOngoing});
   setFiles([]);form.current?.reset();setKind('invoice');setMessage(`${saved} document${saved===1?'':'s'} saved against this work order. No email was sent and no payment status was changed.`);router.refresh();
  }catch(error){
   if(error instanceof StaffDocumentBatchError){setUncertain(true);setMessage(`${error.savedCount} document${error.savedCount===1?'':'s'} confirmed saved. ${error.message}`);router.refresh();}
   else setMessage(error instanceof Error?error.message:'Upload failed.');
  }finally{lock.current=false;setBusy(false);}
 }
 async function open(path:string){try{const {data,error}=await createClient().storage.from(STAFF_DOCUMENT_BUCKET).createSignedUrl(path,60);if(error||!data)throw new Error('Document could not be opened.');window.open(data.signedUrl,'_blank','noopener,noreferrer');}catch{setMessage('Document could not be opened. Please reload and try again.');}}
 return <section id="staff-documents" className="panel tenant-card wo-workflow"><h2>{manager?(isOngoing?'Upload monthly invoices':'Upload documents received by the team'):'Documents added by the team'}</h2>
 {manager&&<><p>Attach an emailed invoice or completed job card to <strong>{workOrderNumber}</strong> for <strong>{contractorName||'the assigned contractor'}</strong>. {isOngoing?`Select up to ${MAX_STAFF_INVOICE_FILES} monthly invoices at a time, or add a job card separately. Each file is saved independently; earlier months are kept. Include the invoice month in the filename for easy identification.`:"Upload each document separately."} Existing contractor uploads are kept.</p><p>PDF, JPG or PNG, up to 10 MB. Record each invoice’s number, date and amount separately in Creditors for financial tracking. Attaching a file does not add spending, send email, approve an invoice or record a payment.</p>
 {!canUpload&&<p>Assign a contractor to a non-cancelled work order before uploading.</p>}
 <form ref={form} className="tenant-form" onSubmit={upload}><label>Document type<select disabled={busy} value={kind} onChange={e=>{setKind(e.target.value as StaffDocumentType);setFiles([]);form.current?.reset();}}><option value="invoice">Invoice</option><option value="job-card">Completed job card</option></select></label><label>{isOngoing&&kind==='invoice'?'Monthly invoice files':'Document file'}<input disabled={busy||!canUpload||loadError||uncertain} required multiple={isOngoing&&kind==='invoice'} type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setFiles(Array.from(e.target.files??[]))}/></label>{files.length>0&&<ul aria-label="Selected documents">{files.map((file,index)=><li key={index}>{file.name}</li>)}</ul>}<button className="primary" disabled={busy||!files.length||!canUpload||loadError||uncertain}>{busy?'Uploading…':isOngoing&&kind==='invoice'?'Upload monthly invoices':'Upload to this work order'}</button></form></>}
 {loadError&&<p role="alert">Staff-uploaded documents could not be loaded. Reload before uploading; this is not an empty document list.</p>}{message&&<p role="status">{message}</p>}
 <h3>Staff-uploaded documents</h3>{documents.map(d=><article className="wo-submission" key={d.id}><p>Added by the team{manager?` (${d.uploaded_by_email})`:''} · {new Date(d.uploaded_at).toLocaleString('en-GB')}</p><button className="unit-secondary" onClick={()=>void open(d.storage_path)}>{d.document_type==='invoice'?'Invoice':'Job card'}: {d.original_name}</button></article>)}{!loadError&&!documents.length&&<p>No documents have been added by the team.</p>}</section>;
}
