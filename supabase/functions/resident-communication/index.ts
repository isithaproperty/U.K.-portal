
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function emailHtml(subject: string, message: string, blockNames: string[]) {
  return `<!doctype html><html><body style="margin:0;background:#f6f3ed;font-family:Arial,sans-serif;color:#1b1814">
  <div style="max-width:640px;margin:0 auto;padding:28px 18px">
    <div style="background:#15120f;color:#d4af37;padding:22px 26px;border-radius:12px 12px 0 0">
      <div style="font-size:12px;letter-spacing:1.5px;font-weight:700">AVIAF ASSET MANAGEMENT</div>
      <h1 style="margin:8px 0 0;font-size:24px;color:#fff">${esc(subject)}</h1>
    </div>
    <div style="background:#fff;padding:26px;border:1px solid #e4dccf;border-top:0;border-radius:0 0 12px 12px">
      <p>Hello,</p>
      <p>${esc(message).replaceAll("\n","<br>")}</p>
      <p>Regards,<br>AVIAF Asset Management</p>
      <hr style="border:none;border-top:1px solid #e8e0d3;margin:26px 0">
      <p style="font-size:12px;color:#766f64;margin:0">This communication relates to: ${blockNames.map(esc).join(", ")}.</p>
    </div>
  </div></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const secretKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secretKey) return json({ error: "Server configuration missing" }, 500);

  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.email) return json({ error: "Unauthorized" }, 401);
  const callerEmail = user.email.toLowerCase();

  const { data: member } = await admin.from("portal_members").select("role,portfolio_manager").eq("email", callerEmail).maybeSingle();
  if (!member || !["owner","admin","manager"].includes(member.role)) return json({ error: "Forbidden" }, 403);

  const payload = await req.json().catch(() => ({}));
  const subject = String(payload.subject || "").trim();
  const message = String(payload.message || "").trim();
  const requested = Array.isArray(payload.blockIds) ? payload.blockIds.map(Number).filter((x:number)=>Number.isInteger(x)&&x>0) : [];
  const blockIds = [...new Set(requested)];

  if (subject.length>200 || message.length>10000 || blockIds.length>500) return json({error:"Use a subject up to 200 characters, a message up to 10,000 characters and up to 500 blocks."},400);
  if (!subject || !message || !blockIds.length) return json({ error: "Select at least one block and enter a subject and message." }, 400);

  const { data: blockRows, error: blockError } = await admin.from("blocks").select("id,name,manager").in("id", blockIds);
  if (blockError || !blockRows || blockRows.length !== blockIds.length) return json({ error: "One or more selected blocks could not be found." }, 400);

  if (member.role === "manager" && blockRows.some((b:any)=>b.manager !== member.portfolio_manager)) {
    return json({ error: "You can only communicate with blocks in your own portfolio." }, 403);
  }

  const { data: residentRows, error: residentError } = await admin.from("residents").select("id,email,block_id").in("block_id", blockIds);
  if (residentError) return json({ error: "Resident recipients could not be loaded." }, 500);

  const recipients = [...new Set((residentRows || []).map((r:any)=>String(r.email || "").trim().toLowerCase()).filter((e:string)=>e.includes("@")))];
  if (!recipients.length) return json({ error: "There are no resident email addresses in the selected blocks." }, 400);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  const replyTo = Deno.env.get("RESEND_REPLY_TO_EMAIL");
  if (!resendKey || !from) {
    return json({ error: "Email is not configured yet", missing: [!resendKey ? "RESEND_API_KEY" : null, !from ? "RESEND_FROM_EMAIL" : null].filter(Boolean) }, 503);
  }

  const blockNames = blockRows.map((b:any)=>b.name);
  const html = emailHtml(subject, message, blockNames);
  const runId = crypto.randomUUID();
  const resendIds:string[] = [];
  let sendError:string|null = null;

  for (let i=0;i<recipients.length;i+=100) {
    const chunk = recipients.slice(i,i+100);
    const batch = chunk.map((to:string)=>({
      from,
      to:[to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      tags:[{name:"category",value:"resident_communication"}]
    }));
    const response = await fetch("https://api.resend.com/emails/batch", {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${resendKey}`,
        "Content-Type":"application/json",
        "Idempotency-Key":`resident-communication/${runId}/${i/100}`
      },
      body:JSON.stringify(batch)
    });
    const body = await response.json().catch(()=>({}));
    if (!response.ok) {
      sendError = JSON.stringify(body).slice(0,1500);
      break;
    }
    const ids = Array.isArray(body?.data) ? body.data.map((x:any)=>String(x.id || "")).filter(Boolean) : [];
    resendIds.push(...ids);
  }

  const status = sendError ? "failed" : "sent";
  const {error:saveError} = await admin.from("communications").insert({
    subject,
    message,
    block_ids:blockIds,
    recipient_count:recipients.length,
    recipient_snapshot:(residentRows||[]).map((r:any)=>({resident_id:r.id,block_id:r.block_id,email:String(r.email||"").trim().toLowerCase()})),
    status,
    sent_by:callerEmail,
    resend_ids:resendIds,
    error_message:sendError
  });

  if(saveError && !sendError) return json({error:"Emails were sent, but the resident portal copy could not be saved. Please contact the managing team rather than resending.",emailSent:true,portalSaved:false},500);
  if (sendError) return json({ error: "Communication could not be sent.", detail: sendError }, 502);
  return json({ ok:true, recipientCount:recipients.length, blockCount:blockIds.length });
});

