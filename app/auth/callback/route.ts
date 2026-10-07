import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { safeAuthRedirect } from "../../../lib/auth-redirect";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const next = safeAuthRedirect(requestedNext, url.origin);
  if (code) {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(next);
  }
  return NextResponse.redirect(new URL("/login?error=signin", url.origin));
}
