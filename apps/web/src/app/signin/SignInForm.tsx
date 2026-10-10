"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { Card, Field, safeNext } from "@/components/forms";

export function SignInForm({ next, passwordReset }: { next: string | null; passwordReset: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/api/auth/signin", { body: { email, password } });
      router.push(safeNext(next));
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't sign in. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card title="Sign in" intro="Your ledger syncs across devices, and you can follow other readers.">
      <form onSubmit={submit} noValidate>
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <Field id="password" label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="err" role="alert">{err}</p>
        <div className="confirm">
          <button className="btn solid" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          {passwordReset && <Link href="/reset">Forgot your password?</Link>}
        </div>
      </form>
      <p className="hint">New here? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}>Create an account</Link>. You can also keep using Redart without one.</p>
    </Card>
  );
}
