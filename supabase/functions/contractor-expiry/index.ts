import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const escape=(s:unknown)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
Deno.serve(async req=>{const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});if(req.method==='OPTIONS')return reply({});if(req.method!=='POST')return reply({error:'POST required'},405);
try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const scheduler=req.headers.get('x-scheduler-token');let allowed=false;
 if(scheduler){const {data,error}=await db.rpc('check_contractor_expiry_scheduler',{p_token:scheduler});allowed=!error&&data===true;}
 else{const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(token){const {data:{user},error}=await db.auth.getUser(token);if(!error&&user?.email){const {data:m}=await db.from('portal_members').select('role').eq('email',user.email.toLowerCase()).maybeSingle();allowed=['owner','admin','manager'].includes(m?.role||'');}}}
 if(!allowed)return reply({error:'Unauthorized'},401);
 const {data:paused,error:pauseError}=await db.rpc('run_contractor_expiry_check');if(pauseError)return reply({error:'Expiry check failed'},500);
 const api=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('RESEND_FROM_EMAIL');if(!api||!from)return reply({paused,emailPending:true,error:'Expiry checks completed. Renewal emails are queued until IT configures email sending.'},503);
 const {data:jobs,error}=await db.rpc('claim_contractor_expiry_notices',{p_limit:20});if(error)return reply({error:'Could not read queued renewal notices'},500);let sent=0,failed=0;
 for(const job of jobs||[]){try{
  const {data:current,error:currentError}=await db.rpc('current_contractor_expired_documents',{p_id:job.contractor_id});if(currentError)throw new Error('Could not verify current expiry status');
  const {data:c,error:contractorError}=await db.from('contractors').select('status,email').eq('id',job.contractor_id).maybeSingle();if(contractorError)throw new Error('Could not verify contractor');
  if(!c||c.status!=='Suspended'||!current?.length||JSON.stringify(current)!==JSON.stringify(job.payload.documents)||(c.email?.trim().toLowerCase()||null)!==job.payload.contractorEmail){const {error}=await db.from('contractor_expiry_notices').update({status:'Cancelled',locked_until:null}).eq('id',job.id);if(error)throw error;continue;}
  const p=job.payload;const html=`<h1>Contractor paused: ${escape(p.company)}</h1><p>The following documents have expired:</p><ul>${p.documents.map((d:any)=>`<li>${escape(d.type)} — expiry ${escape(d.expiry)}</li>`).join('')}</ul><p>This contractor is suspended for new work orders until current documents are uploaded and reviewed by AVIAF.</p><p><a href="${escape(p.renewalLink)}">Contractor: upload replacement documents</a></p><p>Sign in using ${escape(p.contractorEmail)}.</p><p><a href="${escape(p.managerLink)}">Property manager: review the contractor documents in the portal</a></p>`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${api}`,'Content-Type':'application/json','Idempotency-Key':`contractor-expiry-${job.id}`},body:JSON.stringify({from,to:[job.recipient],subject:`Documents expired — ${p.company} paused`,html}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Email provider rejected the renewal notice');
  const {error}=await db.from('contractor_expiry_notices').update({status:'Sent',sent_at:new Date().toISOString(),locked_until:null,last_error:null}).eq('id',job.id);if(error)throw new Error('Email sent but delivery status could not be saved');sent++;
 }catch(e){failed++;await db.from('contractor_expiry_notices').update({status:'Failed',locked_until:null,next_attempt_at:new Date(Date.now()+3600000).toISOString(),last_error:e instanceof Error?e.message:'Notification failed'}).eq('id',job.id);}
 await new Promise(resolve=>setTimeout(resolve,550));
 }
 return reply({paused,sent,failed});
}catch{return reply({error:'Expiry check unavailable'},500);}});
