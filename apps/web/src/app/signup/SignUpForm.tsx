"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ACCOUNT_LIMITS, signupBody, type Me } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { plural } from "@/lib/format";
import { Card, Field, safeNext } from "@/components/forms";
import { importGuestLedgerNow, readGuestLedger, type GuestLedgerSummary } from "@/components/ledger/LedgerContext";

/** "Ada Lovelace" -> "ada_lovelace" */
const suggestHandle = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_").slice(0, ACCOUNT_LIMITS.handleMax);

export function SignUpForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [guest, setGuest] = useState<GuestLedgerSummary | null>(null);
  const [bringGuest, setBringGuest] = useState(true);

  // localStorage is only readable after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setGuest(readGuestLedger()?.summary ?? null), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const body = { displayName, handle, email, password };
    const check = signupBody.safeParse(body);
    if (!check.success) {
      const f: Record<string, string> = {};
      for (const i of check.error.issues) f[String(i.path[0])] ??= i.message;
      setErrors(f);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { user } = await api<{ user: Me }>("/api/auth/signup", { body });
      if (guest && bringGuest) await importGuestLedgerNow(user.id).catch(() => null); // they can retry from the ledger banner
      router.push(safeNext(next));
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) { setErrors(e.fields); setErr(e.message); } else setErr("Couldn't create the account. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card title="Create an account" intro="Sync your ledger across devices, follow other readers, and join monthly reading challenges.">
      <form onSubmit={submit} noValidate>
        <Field id="displayName" label="Your name" autoComplete="name" required maxLength={ACCOUNT_LIMITS.displayName} autoFocus
          value={displayName} error={errors.displayName}
          onChange={(e) => { setDisplayName(e.target.value); if (!handleTouched) setHandle(suggestHandle(e.target.value)); }} />
        <Field id="handle" label="Handle" autoComplete="username" required maxLength={ACCOUNT_LIMITS.handleMax}
          value={handle} error={errors.handle} hint={handle ? <>Your profile will be at /u/{handle.toLowerCase()}</> : "Letters, numbers and underscores."}
          onChange={(e) => { setHandle(e.target.value); setHandleTouched(true); }} />
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
        <Field id="password" label="Password" type="password" autoComplete="new-password" required value={password} error={errors.password}
          hint={`At least ${ACCOUNT_LIMITS.passwordMin} characters. A short sentence works well.`} onChange={(e) => setPassword(e.target.value)} />
        {guest && (
          <p>
            <label className="confirm">
              <input type="checkbox" checked={bringGuest} onChange={(e) => setBringGuest(e.target.checked)} />
              Bring the {plural(guest.plans, "plan")} and {plural(guest.articles, "article")} on this device into my account
            </label>
          </p>
        )}
        <p className="err" role="alert">{err}</p>
        <button className="btn solid" type="submit" disabled={busy}>{busy ? "Creating your account…" : "Create account"}</button>
      </form>
      <p className="hint">Already have an account? <Link href="/signin">Sign in</Link>.</p>
    </Card>
  );
}
