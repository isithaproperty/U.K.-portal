"use client";
import { useEffect, useRef, useState } from "react";
type RecoveryInput = { code?: string; token_hash?: string; type?: string; flowId?: string };
export default function ResetPassword() {
  const recovery = useRef<RecoveryInput | null>(null);
  const [ready, setReady] = useState(false), [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  useEffect(() => {
    // Memory only: never persist, log, or echo the recovery credential. Strip it
    // before rendering links or making requests; refresh intentionally needs a new link.
    if (recovery.current) return;
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code"), hash = query.get("token_hash"), flowId = query.get("sb_flow_id");
    if ((!flowId || /^[A-Za-z0-9_-]{8,64}$/.test(flowId)) && !query.has("error") && Boolean(code) !== Boolean(hash) && (code || query.get("type") === "recovery")) {
      recovery.current = code ? { code, ...(flowId ? { flowId } : {}) } : { token_hash: hash!, type: "recovery" };
      setReady(true);
    } else { setInvalid(true); }
    window.history.replaceState(null, "", "/reset-password");
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!recovery.current || busy) return;
    if (password !== confirmation) { setMessage("The passwords do not match."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/auth/recovery/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...recovery.current, password, confirmation }) });
      const data = await response.json();
      setPassword(""); setConfirmation("");
      if (data.success) { recovery.current = null; setDone(true); }
      else { setMessage(data.message); if (data.invalid) { recovery.current = null; setInvalid(true); } }
    } catch { recovery.current = null; setInvalid(true); setMessage("We could not confirm the password update. Try signing in, or request a new reset link."); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit}>
    <p className="eyebrow">LONDON PROPERTY PORTAL</p><h1>{done ? "Password updated" : "Choose a new password"}</h1>
    {done ? <p>Your password has been updated. You can now sign in with your new password.</p> : invalid ? <p>This reset link is missing, invalid or expired. Request a new link and open it in the same browser. Do not refresh this page before submitting.</p> : ready ? <>
      <p>Use 12–128 characters. Choose a unique password you do not use elsewhere.</p>
      <label>New password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>Confirm new password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
    </> : <p>Checking reset link…</p>}
    {message && <p role="status">{message}</p>}{invalid && <p><a href="/forgot-password">Request a new reset link</a></p>}<p><a href="/login">Back to sign in</a></p>
  </form></main>;
}
