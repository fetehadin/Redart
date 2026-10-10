"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ACCOUNT_LIMITS, LIMITS, STARTER, type AccountVisibility, type Me } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { clearMemberData } from "@/lib/store/remote";
import { Field } from "@/components/forms";
import { useToast } from "@/components/Toast";
import styles from "./Settings.module.css";

const SUGGESTED_TOPICS = [...new Set([...STARTER.map((r) => r[2]), "Databases", "Security", "Frontend", "Career"])].sort();

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {intro ? <p className="hint">{intro}</p> : null}
      {children}
    </section>
  );
}

/** Run a save, turning API errors into a message and field errors. */
function useSave() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(""); setFields({});
    try { await fn(); }
    catch (e) {
      if (e instanceof ApiError) { setErr(e.message); setFields(e.fields); } else setErr("Something went wrong. Try again.");
    } finally { setBusy(false); }
  }
  return { busy, err, fields, run };
}

export function Settings({ me: initial }: { me: Me }) {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState(initial);
  const update = async (body: Partial<Me>) => {
    const { user } = await api<{ user: Me }>("/api/me", { method: "PATCH", body });
    setMe(user);
    router.refresh();
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <Profile me={me} update={update} onSaved={() => toast("Profile saved.")} />
      <Privacy me={me} update={update} onSaved={(v) => toast(v === "PRIVATE" ? "Your account is private now." : "Your account is public now.")} />
      <Topics me={me} update={update} onSaved={() => toast("Reading topics saved.")} />
      <Password onSaved={() => toast("Password changed. Other devices were signed out.")} />
      <Sessions />
      <DeleteAccount />
    </div>
  );
}

type Update = (body: Partial<Me>) => Promise<void>;

function Profile({ me, update, onSaved }: { me: Me; update: Update; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [handle, setHandle] = useState(me.handle);
  const [bio, setBio] = useState(me.bio);
  const s = useSave();
  const submit = (e: FormEvent) => { e.preventDefault(); s.run(async () => { await update({ displayName, handle, bio }); onSaved(); }); };
  return (
    <Section title="Profile" intro="This is what other readers see.">
      <form onSubmit={submit} noValidate className={styles.form}>
        <Field id="displayName" label="Name" maxLength={ACCOUNT_LIMITS.displayName} value={displayName} error={s.fields.displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <Field id="handle" label="Handle" maxLength={ACCOUNT_LIMITS.handleMax} value={handle} error={s.fields.handle}
          hint="Changing it changes your profile address." onChange={(e) => setHandle(e.target.value)} />
        <div className={styles.wide}>
          <label className="lbl" htmlFor="bio">About you</label>
          <textarea id="bio" maxLength={ACCOUNT_LIMITS.bio} rows={3} value={bio} onChange={(e) => setBio(e.target.value)}
            placeholder="What do you like to read about?" />
          <span className="hint">{ACCOUNT_LIMITS.bio - bio.length} characters left</span>
        </div>
        <div className={styles.actions}>
          <button className="btn solid" type="submit" disabled={s.busy}>Save profile</button>
          <span className="err" role="alert">{s.err}</span>
        </div>
      </form>
    </Section>
  );
}

function Privacy({ me, update, onSaved }: { me: Me; update: Update; onSaved: (v: AccountVisibility) => void }) {
  const s = useSave();
  // Show the choice at once; put it back if saving fails.
  const [choice, setChoice] = useState(me.visibility);
  const choose = (v: AccountVisibility) => {
    if (v === choice) return;
    setChoice(v);
    s.run(async () => {
      try { await update({ visibility: v }); onSaved(v); } catch (e) { setChoice(me.visibility); throw e; }
    });
  };
  return (
    <Section title="Who can follow you">
      <fieldset className={styles.choices} disabled={s.busy}>
        <legend className="visually-hidden">Account visibility</legend>
        <label>
          <input type="radio" name="visibility" checked={choice === "PUBLIC"} onChange={() => choose("PUBLIC")} />
          <span><strong>Public.</strong> Anyone can follow you and see what you&apos;ve finished, your favourites and your plans.</span>
        </label>
        <label>
          <input type="radio" name="visibility" checked={choice === "PRIVATE"} onChange={() => choose("PRIVATE")} />
          <span><strong>Private.</strong> You approve each follower. Everyone else sees only your name.</span>
        </label>
      </fieldset>
      <p className="hint">Your notes are always private, whatever you choose here.</p>
      <span className="err" role="alert">{s.err}</span>
    </Section>
  );
}

function Topics({ me, update, onSaved }: { me: Me; update: Update; onSaved: () => void }) {
  const [topics, setTopics] = useState(me.topics);
  const [draft, setDraft] = useState("");
  const s = useSave();
  const add = (t: string) => {
    const v = t.trim().slice(0, LIMITS.topic);
    if (!v || topics.some((x) => x.toLowerCase() === v.toLowerCase()) || topics.length >= ACCOUNT_LIMITS.topics) return;
    setTopics([...topics, v]);
    setDraft("");
  };
  const changed = topics.join("\n") !== me.topics.join("\n");
  return (
    <Section title="What you like to read" intro="Challenges about these topics are shown to you first.">
      <ul className={styles.chips} aria-label="Your topics">
        {topics.map((t) => (
          <li key={t}>{t} <button type="button" aria-label={`Remove ${t}`} onClick={() => setTopics(topics.filter((x) => x !== t))}>×</button></li>
        ))}
        {!topics.length && <li className={styles.none}>No topics yet.</li>}
      </ul>
      <form className={styles.inline} onSubmit={(e) => { e.preventDefault(); add(draft); }}>
        <label className="visually-hidden" htmlFor="topicDraft">Add a topic</label>
        <input id="topicDraft" type="text" list="topicSuggestions" maxLength={LIMITS.topic} placeholder="Add a topic, e.g. Postgres" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <datalist id="topicSuggestions">{SUGGESTED_TOPICS.map((t) => <option key={t} value={t} />)}</datalist>
        <button className="btn" type="submit" disabled={!draft.trim() || topics.length >= ACCOUNT_LIMITS.topics}>Add</button>
      </form>
      <div className={styles.actions}>
        <button className="btn solid" type="button" disabled={!changed || s.busy} onClick={() => s.run(async () => { await update({ topics }); onSaved(); })}>Save topics</button>
        <span className="err" role="alert">{s.err}</span>
      </div>
    </Section>
  );
}

function Password({ onSaved }: { onSaved: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const s = useSave();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    s.run(async () => {
      await api("/api/me/password", { method: "PATCH", body: { currentPassword, newPassword } });
      setCurrent(""); setNext("");
      onSaved();
    });
  };
  return (
    <Section title="Password">
      <form onSubmit={submit} noValidate className={styles.form}>
        <Field id="currentPassword" label="Current password" type="password" autoComplete="current-password" value={currentPassword} error={s.fields.currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        <Field id="newPassword" label="New password" type="password" autoComplete="new-password" value={newPassword} error={s.fields.newPassword}
          hint={`At least ${ACCOUNT_LIMITS.passwordMin} characters.`} onChange={(e) => setNext(e.target.value)} />
        <div className={styles.actions}>
          <button className="btn solid" type="submit" disabled={s.busy || !currentPassword || !newPassword}>Change password</button>
          <span className="err" role="alert">{s.err}</span>
        </div>
      </form>
    </Section>
  );
}

function Sessions() {
  const router = useRouter();
  const s = useSave();
  return (
    <Section title="Devices" intro="Signed in on a shared or lost device? Sign out everywhere, including here.">
      <button className="btn" type="button" disabled={s.busy} onClick={() => s.run(async () => {
        await api("/api/auth/signout-all", { body: {} });
        try { clearMemberData(window.localStorage); } catch { /* ignore */ }
        router.push("/signin");
        router.refresh();
      })}>Sign out everywhere</button>
      <span className="err" role="alert">{s.err}</span>
    </Section>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const s = useSave();
  return (
    <Section title="Delete account" intro="This removes your account, plans, notes, favourites and followers straight away. It can't be undone.">
      {!open ? (
        <button className="btn danger" type="button" onClick={() => setOpen(true)}>Delete my account…</button>
      ) : (
        <form className={styles.form} noValidate onSubmit={(e) => {
          e.preventDefault();
          s.run(async () => {
            await api("/api/me", { method: "DELETE", body: { password } });
            try { clearMemberData(window.localStorage); } catch { /* ignore */ }
            router.push("/");
            router.refresh();
          });
        }}>
          <Field id="deletePassword" label="Type your password to confirm" type="password" autoComplete="current-password" autoFocus
            value={password} error={s.fields.password} onChange={(e) => setPassword(e.target.value)} />
          <div className={styles.actions}>
            <button className="btn danger" type="submit" disabled={s.busy || !password}>Delete everything</button>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Keep my account</button>
            <span className="err" role="alert">{s.err}</span>
          </div>
        </form>
      )}
    </Section>
  );
}
