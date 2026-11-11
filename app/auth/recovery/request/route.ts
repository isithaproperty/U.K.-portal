import { NextRequest, NextResponse } from "next/server";
import { REQUEST_MESSAGE } from "../../../../lib/password-recovery";
import { privateResponse, recoveryClient, sameOrigin } from "../../../../lib/supabase/recovery";
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateResponse(NextResponse.json({ message: "Request not allowed." }, { status: 403 }));
  const response = privateResponse(NextResponse.json({ message: REQUEST_MESSAGE }));
  try {
    const { email } = await request.json();
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return response;
    const client = recoveryClient(request, response);
    await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${request.nextUrl.origin}/auth/recovery/callback` });
  } catch { /* Never expose account existence, provider details, or credentials. */ }
  return response;
}
