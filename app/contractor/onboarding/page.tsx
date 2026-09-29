import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import ContractorOnboardingClient from "./ContractorOnboardingClient";

export const dynamic="force-dynamic";

export default async function ContractorOnboardingPage({searchParams}:{searchParams:Promise<{invite?:string}>}){
 const supabase=await createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user?.email)redirect("/contractor/login");
 const email=user.email.toLowerCase();
 const {invite}=await searchParams;
 if(!invite)return <main className="login-page"><div className="login-card"><p className="eyebrow">AVIAF CONTRACTOR PORTAL</p><h1>Invitation required</h1><p>Please open the contractor onboarding link sent by AVIAF.</p></div></main>;
 const {data:member}=await supabase.from("contractor_members").select("contractor_id,email,invite_expires_at").eq("invite_token",invite).eq("email",email).maybeSingle();
 if(!member)return <main className="login-page"><div className="login-card"><p className="eyebrow">AVIAF CONTRACTOR PORTAL</p><h1>Invitation not valid</h1><p>This invitation does not match your signed-in email address. Please use the email address the invitation was issued to.</p></div></main>;
 if(new Date(member.invite_expires_at).getTime()<Date.now())return <main className="login-page"><div className="login-card"><p className="eyebrow">AVIAF CONTRACTOR PORTAL</p><h1>Invitation expired</h1><p>Please ask AVIAF to generate a new onboarding link.</p></div></main>;
 const contractorId=member.contractor_id;
 const [contractorResult,tradeResult,onboardingResult,docsResult]=await Promise.all([
  supabase.from("contractors").select("id,company_name,email,phone,status").eq("id",contractorId).single(),
  supabase.from("contractor_trades").select("trade").eq("contractor_id",contractorId).order("trade"),
  supabase.from("contractor_onboarding").select("employee_count,transports_waste,undertakes_design,undertakes_asbestos,uses_subcontractors,onboarding_status,declaration_name,declaration_accepted_at,review_notes,reviewed_at").eq("contractor_id",contractorId).maybeSingle(),
  supabase.from("contractor_documents").select("id,document_type,file_name,storage_path,mime_type,file_size,expiry_date,notes,uploaded_at,uploaded_by").eq("contractor_id",contractorId).order("uploaded_at",{ascending:false})
 ]);
 if(contractorResult.error||tradeResult.error||onboardingResult.error||docsResult.error)return <main className="login-page"><div className="login-card"><h1>Onboarding unavailable</h1><p>Please try again shortly.</p></div></main>;
 return <ContractorOnboardingClient contractor={contractorResult.data} initialTrades={(tradeResult.data??[]).map(r=>r.trade)} onboarding={onboardingResult.data} documents={docsResult.data??[]} viewerEmail={email}/>;
}