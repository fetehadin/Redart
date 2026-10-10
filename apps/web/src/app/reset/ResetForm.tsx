"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ACCOUNT_LIMITS } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { Card, Field } from "@/components/forms";

export function ResetForm({ token }: { token: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (token) await api("/api/auth/reset/confirm", { body: { token, password } });
      else await api("/api/auth/reset/request", { body: { email } });
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return token
      ? <Card title="Password changed"><p>You can sign in with your new password now. Other devices were signed out.</p><p><Link className="btn solid" href="/signin">Sign in</Link></p></Card>
      : <Card title="Check your email"><p>If there&apos;s an account for that address, we&apos;ve sent a link to reset its password. The link works for 30 minutes.</p></Card>;
  }

  return token ? (
    <Card title="Choose a new password">
      <form onSubmit={submit} noValidate>
        <Field id="password" label="New password" type="password" autoComplete="new-password" required autoFocus value={password}
          hint={`At least ${ACCOUNT_LIMITS.passwordMin} characters.`} onChange={(e) => setPassword(e.target.value)} />
        <p className="err" role="alert">{err}</p>
        <button className="btn solid" type="submit" disabled={busy}>Save new password</button>
      </form>
    </Card>
  ) : (
    <Card title="Reset your password" intro="Enter the email you signed up with and we'll send you a link.">
      <form onSubmit={submit} noValidate>
        <Field id="email" label="Email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="err" role="alert">{err}</p>
        <button className="btn solid" type="submit" disabled={busy}>Send the link</button>
      </form>
    </Card>
  );
}
