"use client";
import { useState } from "react";
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/auth/recovery/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json();
      setMessage(data.message); setSent(response.ok);
    } catch { setMessage("The reset request could not be sent. Please try again later."); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <p className="eyebrow">LONDON PROPERTY PORTAL</p><h1>Forgot password?</h1>
    <p>Enter your account email to request a secure password reset link. Open the link in this same browser.</p>
    <label>Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
    <button className="primary" disabled={busy || sent}>{busy ? "Requesting…" : sent ? "Request received" : "Send reset link"}</button>
    {message && <p role="status">{message}</p>}<p><a href="/login">Back to sign in</a></p>
  </form></main>;
}
