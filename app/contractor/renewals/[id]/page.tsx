import {notFound,redirect} from 'next/navigation';
import {createClient} from '../../../../lib/supabase/server';
import ContractorRenewal from './ContractorRenewal';
export const dynamic='force-dynamic';
export default async function Renewal({params}:{params:Promise<{id:string}>}){
 const id=Number((await params).id);if(!Number.isSafeInteger(id)||id<1)notFound();const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user?.email)redirect(`/contractor/login?next=${encodeURIComponent(`/contractor/renewals/${id}`)}`);
 const {data:c}=await db.from('contractors').select('id,company_name,email,status,expiry_pause_reason').eq('id',id).maybeSingle();if(!c||c.email?.trim().toLowerCase()!==user.email.toLowerCase())notFound();
 const {data:member}=await db.from('contractor_members').select('id').eq('contractor_id',id).eq('email',user.email.toLowerCase()).maybeSingle();if(!member)notFound();
 const {data:docs,error}=await db.from('contractor_documents').select('id,document_type,file_name,expiry_date,uploaded_at').eq('contractor_id',id).order('uploaded_at',{ascending:false});if(error)throw new Error('Documents unavailable');
 return <ContractorRenewal contractor={c} documents={docs??[]} email={user.email.toLowerCase()}/>;
}
