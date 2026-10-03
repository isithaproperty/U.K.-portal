import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: member } = await supabase.from("portal_members").select("role").eq("email", user.email.toLowerCase()).maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "manager");
  const portfolioManager = String(body.portfolioManager ?? "").trim() || null;
  if (!email || !email.includes("@") || password.length < 10) return NextResponse.json({ error: "Enter a valid email and a temporary password of at least 10 characters." }, { status: 400 });
  if (!["admin", "manager"].includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { must_change_password: true } });
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });

  const { error: memberError } = await admin.from("portal_members").upsert({ email, role, portfolio_manager: portfolioManager }, { onConflict: "email" });
  if (memberError) {
    if (created.user) await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: memberError.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, email, role });
}
