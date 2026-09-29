"use client";
import { useState } from "react";
import { createClient } from "../../lib/supabase/browser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setMessage(error ? error.message : "Check your email for a sign-in link.");
    } catch { setMessage("Sign-in is unavailable right now."); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><form onSubmit={submit} className="login-card"><p className="eyebrow">LONDON PROPERTY PORTAL</p><h1>Sign in</h1><p>Enter your work email to receive a secure sign-in link.</p><label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="primary" disabled={busy}>{busy ? "Sending…" : "Send sign-in link"}</button>{message && <p role="status">{message}</p>}</form></main>;
}
