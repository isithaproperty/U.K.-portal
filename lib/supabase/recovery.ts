// Server-only recovery client: deliberately separate from the normal portal session.
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { RECOVERY_STORAGE, RECOVERY_TTL } from "../password-recovery";

export const recoveryCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/auth/recovery", maxAge: RECOVERY_TTL };
export function recoveryClient(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Recovery is not configured");
  return createServerClient(url, key, {
    cookieOptions: { ...recoveryCookieOptions, name: RECOVERY_STORAGE },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => { for (const { name, value, options } of items) {
        request.cookies.set(name, value);
        response.cookies.set(name, value, { ...options, ...recoveryCookieOptions, ...(options.maxAge === 0 ? { maxAge: 0 } : {}) });
      } },
    },
  });
}
export function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
export function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}
export function clearRecovery(request: NextRequest, response: NextResponse) {
  for (const { name } of request.cookies.getAll()) if (name.startsWith("lp-recovery-")) response.cookies.set(name, "", { ...recoveryCookieOptions, maxAge: 0 });
}
