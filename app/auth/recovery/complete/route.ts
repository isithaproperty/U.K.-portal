import { NextRequest, NextResponse } from "next/server";
import { passwordError } from "../../../../lib/password-recovery";
import { clearRecovery, privateResponse, recoveryClient, sameOrigin } from "../../../../lib/supabase/recovery";
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateResponse(NextResponse.json({ message: "Request not allowed." }, { status: 403 }));
  const response = privateResponse(NextResponse.json({ message: "Your reset link is invalid or expired. Request a new link.", invalid: true }, { status: 400 }));
  try {
    const { password, confirmation, code, token_hash, type, flowId } = await request.json();
    const validation = passwordError(password, confirmation);
    if (validation) return privateResponse(NextResponse.json({ message: validation }, { status: 400 }));
    const hasCode = typeof code === "string" && code.length > 0 && code.length <= 2048;
    const hasHash = typeof token_hash === "string" && token_hash.length > 0 && token_hash.length <= 2048;
    if (hasCode === hasHash || (flowId !== undefined && (typeof flowId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(flowId)))) return response;
    const client = recoveryClient(request, response);
    // Never accept an existing session as recovery proof. Every submission must
    // exchange a fresh single-use code or explicitly verify a recovery token.
    if (hasCode) {
      const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (error || !data.session || (!("redirectType" in data) || data.redirectType !== "recovery")) throw new Error("Invalid recovery");
    } else {
      if (type !== "recovery") return response;
      const { data, error } = await client.auth.verifyOtp({ token_hash, type: "recovery" });
      if (error || !data.session) throw new Error("Invalid recovery");
    }
    const updated = await client.auth.updateUser({ password });
    // Revoke only this isolated recovery session, never unrelated portal sessions.
    await client.auth.signOut({ scope: "local" });
    clearRecovery(request, response);
    const result = privateResponse(NextResponse.json(updated.error
      ? { message: "Password could not be updated. Request a new link and choose a different strong password.", invalid: true }
      : { success: true }, { status: updated.error ? 400 : 200 }));
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    return result;
  } catch { clearRecovery(request, response); return response; }
}
