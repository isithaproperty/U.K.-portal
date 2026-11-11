'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '../lib/supabase/browser';
import {STAFF_DOCUMENT_BUCKET,validateStaffDocument,type StaffDocumentType} from '../lib/staff-work-order-documents';
export type StaffWODocument={id:string;document_type:StaffDocumentType;storage_path:string;original_name:string;uploaded_by_email:string;uploaded_at:string};
export default function StaffWorkOrderDocuments({workOrderId,workOrderNumber,contractorName,contractorId,manager,canUpload,documents,loadError}:{workOrderId:number;workOrderNumber:string;contractorName:string;contractorId:number|null;manager:boolean;canUpload:boolean;documents:StaffWODocument[];loadError:boolean}){
 const router=useRouter(),lock=useRef(false),form=useRef<HTMLFormElement>(null);
 const [kind,setKind]=useState<StaffDocumentType>('invoice'),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[uncertain,setUncertain]=useState(false);
 async function upload(event:React.FormEvent){
  event.preventDefault();if(lock.current||!file||!canUpload||uncertain||loadError)return;
  lock.current=true;setBusy(true);setMessage('');let started=false;
  try{
   const extension=await validateStaffDocument(file),id=crypto.randomUUID(),path=`${workOrderId}/${id}/${kind}.${extension}`,client=createClient();
   const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)throw new Error('Sign in again before uploading.');
   started=true;
   const {error:uploadError}=await client.storage.from(STAFF_DOCUMENT_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
   if(uploadError)throw new Error('Upload was not confirmed.');
   const {error}=await client.from('staff_work_order_documents').insert({id,work_order_id:workOrderId,contractor_id:contractorId,document_type:kind,storage_path:path,original_name:file.name});
   if(error)throw new Error('The document record was not confirmed.');
   setFile(null);form.current?.reset();setKind('invoice');setMessage('Document saved against this work order. No email was sent and no payment status was changed.');router.refresh();
  }catch(error){
   if(started){setUncertain(true);setMessage('The upload could not be confirmed. Reload and check the documents below before trying again. If it is missing, ask an administrator to check for an unlinked file.');}
   else setMessage(error instanceof Error?error.message:'Upload failed.');
  }finally{lock.current=false;setBusy(false);}
 }
 async function open(path:string){try{const {data,error}=await createClient().storage.from(STAFF_DOCUMENT_BUCKET).createSignedUrl(path,60);if(error||!data)throw new Error('Document could not be opened.');window.open(data.signedUrl,'_blank','noopener,noreferrer');}catch{setMessage('Document could not be opened. Please reload and try again.');}}
 return <section className="panel tenant-card wo-workflow"><h2>{manager?'Upload documents received by the team':'Documents added by the team'}</h2>
 {manager&&<><p>Attach an emailed invoice or completed job card to <strong>{workOrderNumber}</strong> for <strong>{contractorName||'the assigned contractor'}</strong>. Upload each document separately. Existing contractor uploads are kept.</p><p>PDF, JPG or PNG, up to 10 MB. This does not send email, approve an invoice or record a payment.</p>
 {!canUpload&&<p>Assign a contractor to a non-cancelled work order before uploading.</p>}
 <form ref={form} className="tenant-form" onSubmit={upload}><label>Document type<select disabled={busy} value={kind} onChange={e=>setKind(e.target.value as StaffDocumentType)}><option value="invoice">Invoice</option><option value="job-card">Completed job card</option></select></label><label>Document file<input disabled={busy} required type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button className="primary" disabled={busy||!file||!canUpload||loadError||uncertain}>{busy?'Uploading…':'Upload to this work order'}</button></form></>}
 {loadError&&<p role="alert">Staff-uploaded documents could not be loaded. Reload before uploading; this is not an empty document list.</p>}{message&&<p role="status">{message}</p>}
 <h3>Staff-uploaded documents</h3>{documents.map(d=><article className="wo-submission" key={d.id}><p>Added by the team{manager?` (${d.uploaded_by_email})`:''} · {new Date(d.uploaded_at).toLocaleString('en-GB')}</p><button className="unit-secondary" onClick={()=>void open(d.storage_path)}>{d.document_type==='invoice'?'Invoice':'Job card'}: {d.original_name}</button></article>)}{!loadError&&!documents.length&&<p>No documents have been added by the team.</p>}</section>;
}
