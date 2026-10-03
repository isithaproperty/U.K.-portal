"use client";
import { useState } from "react";
import { createClient } from "../../lib/supabase/browser";

export default function Login({tenant=false}:{tenant?:boolean}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        return;
      }
      window.location.href = tenant ? "/tenant" : "/";
    } catch {
      setMessage("Sign-in is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page"><form onSubmit={submit} className="login-card"><p className="eyebrow">LONDON PROPERTY PORTAL</p><h1>{tenant?"Tenant sign in":"Sign in"}</h1><p>{tenant?"Enter the email and password for your resident account.":"Enter your work email and password."}</p><label>Email address<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>{message && <p role="status">{message}</p>}</form></main>;
}
