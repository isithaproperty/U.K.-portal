"use client";
import {useEffect,useState} from "react";
import {createClient} from "../../../lib/supabase/browser";

export default function ContractorLogin(){
 const[email,setEmail]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{const q=new URLSearchParams(window.location.search);setEmail(q.get("email")||"");},[]);
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  const q=new URLSearchParams(window.location.search);const invite=q.get("invite")||"";const next=invite?`/contractor/onboarding?invite=${encodeURIComponent(invite)}`:"/contractor/onboarding";const redirect=`${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const {error}=await createClient().auth.signInWithOtp({email:email.trim().toLowerCase(),options:{emailRedirectTo:redirect}});
  setMessage(error?error.message:"Check your email for your secure onboarding link.");
  setBusy(false);
 }
 return <main className="login-page"><form onSubmit={submit} className="login-card">
  <p className="eyebrow">AVIAF CONTRACTOR PORTAL</p><h1>Contractor onboarding</h1>
  <p>Use the email address invited by AVIAF. We will send you a secure sign-in link.</p>
  <label>Email address<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
  <button className="primary" disabled={busy}>{busy?"Sending…":"Send secure sign-in link"}</button>
  {message&&<p role="status">{message}</p>}
 </form></main>;
}