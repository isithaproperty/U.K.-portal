import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import TenantPortal from "./TenantPortal";
import {londonDate} from "../../lib/service-charges";

export const dynamic = "force-dynamic";
export default async function TenantPage({searchParams}:{searchParams:Promise<{resident?:string}>}) {
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user?.email) redirect("/tenant/login");
 const email=user.email.toLowerCase();
 const {data:member}=await supabase.from("portal_members").select("role").eq("email",email).maybeSingle();
 const preview=["owner","admin","manager"].includes(member?.role??"");
 const params=await searchParams;
 let query=supabase.from("residents").select("id,unit_id,block_id,full_name,email,phone").is("archived_at",null);
 if(preview&&params.resident&&/^\d+$/.test(params.resident)) query=query.eq("id",Number(params.resident));
 else query=query.eq("email",email);
 const {data:residents,error}=await query;
 if(error) return <main className="login-page"><div className="login-card"><h1>Tenant portal unavailable</h1><p>Please try again shortly.</p><Link href="/">Return to portal</Link></div></main>;
 if(!residents?.length) return <main className="login-page"><div className="login-card"><h1>{preview?"Choose a tenant to preview":"Access pending"}</h1><p>{preview?"Open Units & residents and choose Preview tenant portal beside a resident.":"Your email has not been assigned to a home. Please contact your managing team."}</p><Link href="/">Return to portal</Link></div></main>;
 const blockIds=[...new Set(residents.map(r=>r.block_id))];
 const unitIds=[...new Set(residents.map(r=>r.unit_id))];
 const [b,u,r]=await Promise.all([
  supabase.from("blocks").select("id,name,address,management_company,manager").in("id",blockIds),
  supabase.from("units").select("id,unit_number,payment_reference").in("id",unitIds),
  supabase.from("tenant_requests").select("id,resident_id,block_id,unit_id,title,description,category,priority,status,manager_reply,created_at,updated_at").in("resident_id",residents.map(x=>x.id)).order("created_at",{ascending:false})
 ]);
 if(b.error||u.error||r.error) return <main className="login-page"><div className="login-card"><h1>Tenant portal unavailable</h1><p>Please try again shortly.</p><Link href="/">Return to portal</Link></div></main>;
 const {data:documentSettings,error:documentError}=await supabase.from("service_charge_document_settings").select("block_id,settings").in("block_id",blockIds);
 if(documentError)return <main className="login-page"><div className="login-card"><h1>Service charge documents unavailable</h1><p>Please try again shortly.</p></div></main>;
 const homes=residents.flatMap(person=>{
  const block=b.data?.find(x=>x.id===person.block_id),unit=u.data?.find(x=>x.id===person.unit_id);
  return block&&unit?[{documentSettings:documentSettings?.find(x=>x.block_id===person.block_id)?.settings,residentId:person.id,unitId:person.unit_id,blockId:person.block_id,name:person.full_name,email:person.email,phone:person.phone,unit:unit.unit_number,paymentReference:unit.payment_reference,building:block.name,address:block.address,company:block.management_company,manager:block.manager}]:[];
 });
 if(!homes.length) return <main className="login-page"><div className="login-card"><h1>Home details unavailable</h1><p>Please contact your managing team.</p><Link href="/">Return to portal</Link></div></main>;
 const {data:charges,error:chargeError}=await supabase.from("service_charge_entries").select("id,block_id,unit_id,entry_type,description,amount_pence,entry_date,due_date,reference").in("unit_id",unitIds).order("entry_date",{ascending:false});
 if(chargeError)return <main className="login-page"><div className="login-card"><h1>Service charges unavailable</h1><p>Please try again shortly.</p></div></main>;
 const {data:communications,error:communicationError}=await supabase.from("resident_messages").select("id,resident_id,block_id,subject,message,sent_at").in("resident_id",residents.map(person=>person.id)).order("sent_at",{ascending:false}).limit(200);
 return <TenantPortal communications={communications??[]} communicationsUnavailable={!!communicationError} charges={charges??[]} today={londonDate()} homes={homes} requests={r.data??[]} preview={preview}/>;
}
