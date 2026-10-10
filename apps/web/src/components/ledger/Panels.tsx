"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  addDays, LIMITS, nextDueDate, parseISO, planEnd, safeUrl, sanitizeState, urlKey, type LedgerState,
} from "@redart/shared";
import { inspectUrl, isRetryable } from "@/lib/inspect";
import { plural, short } from "@/lib/format";
import { cx } from "@/lib/cx";
import { useLedgerApi, type PlanSeed } from "./LedgerContext";
import s from "./Ledger.module.css";

/** A <details> panel whose open state the parent can control. */
export function Panel({ id, title, open, onOpenChange, children }: {
  id: string; title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
}) {
  return (
    <details className="panel" id={id} open={open} onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function Field({ id, label, wide, hint, children }: { id: string; label: string; wide?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className={cx("field", wide && "wide")}>
      <label className="lbl" htmlFor={id}>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

const validDays = (n: number) => Number.isInteger(n) && n >= LIMITS.minDays && n <= LIMITS.maxDays;

/* ---------------- Add an article ---------------- */

type InspectView = { cls: "" | "ok" | "bad" | "warn" | "muted"; text: string; spinner?: boolean };

export function AddArticle({ onAdded }: { onAdded: () => void }) {
  const { plan, today, addArticle } = useLedgerApi();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [mins, setMins] = useState("");
  const [due, setDue] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState<InspectView>({ cls: "", text: "" });
  // Title and minutes stay ours to fill until the reader types their own.
  const titleAuto = useRef(true);
  const minutesAuto = useRef(true);
  const lastInspected = useRef<string | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function runInspect(raw: string) {
    raw = raw.trim();
    if (!raw) { setView({ cls: "", text: "" }); lastInspected.current = null; return; }
    const u = safeUrl(raw);
    if (!u) { setView({ cls: "bad", text: "That doesn't look like a web address yet." }); lastInspected.current = null; return; }
    const k = urlKey(u);
    if (k === lastInspected.current) return;
    lastInspected.current = k;
    const mine = ++token.current;
    const dup = plan.articles.find((a) => urlKey(a.url) === k);
    if (dup) { setView({ cls: "warn", text: `Already in this plan as “${short(dup.title, 60)}”.` }); return; }
    setView({ cls: "muted", text: "Checking the link and counting words…", spinner: true });
    const r = await inspectUrl(u);
    if (mine !== token.current || urlKey(urlRef.current?.value) !== k) return; // the reader moved on
    if (r.title && titleAuto.current) setTitle(r.title);
    if (r.status === "ok" && Number.isInteger(r.minutes) && minutesAuto.current) setMins(String(r.minutes));
    const words = Number.isInteger(r.words) && r.words! > 0 ? ` · ${r.words!.toLocaleString()} words` : "";
    if (r.status === "ok") setView(r.minutes
      ? { cls: "ok", text: `✓ Link works · about ${r.minutes} min read${words}` }
      : { cls: "warn", text: "✓ Link works. " + r.message.replace(/^Link works,?\s*/i, "") });
    else if (r.status === "restricted") setView({ cls: "warn", text: "? " + r.message });
    else if (["offline", "unavailable", "network", "rate_limited", "timeout", "unreachable"].includes(r.status)) setView({ cls: "warn", text: "! " + r.message });
    else setView({ cls: "bad", text: "✕ " + r.message });
    if (isRetryable(r.status)) lastInspected.current = null;
  }
  /** Inspect whatever the link box holds when the timer fires. */
  const inspectSoon = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => runInspect(urlRef.current?.value ?? ""), ms);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    let u = "";
    if (url.trim()) {
      u = safeUrl(url) ?? "";
      if (!u) { setErr("That link doesn't look right. Use a full web address like https://example.com/article."); urlRef.current?.focus(); return; }
    }
    const t = title.trim() || (u ? new URL(u).hostname.replace(/^www\./, "") : "");
    if (!t) { setErr("Add a link or a title so you know what to read."); urlRef.current?.focus(); return; }
    if (u && plan.articles.some((a) => urlKey(a.url) === urlKey(u))) { setErr("This link is already in the plan."); urlRef.current?.focus(); return; }
    const minutes = mins.trim() === "" ? 10 : Number(mins);
    if (!Number.isFinite(minutes) || minutes < LIMITS.minMinutes || minutes > LIMITS.maxMinutes) { setErr("Read time must be between 1 and 600 minutes."); return; }
    if (due && !parseISO(due)) { setErr("Pick a valid due date."); return; }
    addArticle({
      title: t, url: u, topic: topic.trim(), minutes: Math.round(minutes),
      minutesAuto: minutesAuto.current || mins.trim() === "",
      due: due || nextDueDate(plan, today),
    });
    setUrl(""); setTitle(""); setTopic(""); setMins(""); setDue(""); setView({ cls: "", text: "" });
    titleAuto.current = true; minutesAuto.current = true; lastInspected.current = null; token.current++;
    onAdded();
    urlRef.current?.focus();
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field id="aUrl" label="Link" wide>
        <input ref={urlRef} type="url" id="aUrl" placeholder="Paste the article link, e.g. https://martinfowler.com/…" autoComplete="off" inputMode="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); inspectSoon(700); }}
          onPaste={() => inspectSoon(50)}
          onBlur={(e) => { clearTimeout(timer.current); runInspect(e.target.value); }} />
        <div className={s.inspect} aria-live="polite">
          {view.text ? <span className={view.cls ? s[view.cls] : undefined}>{view.spinner ? <><span className="spin" aria-hidden="true" /> </> : null}{view.text}</span> : null}
        </div>
      </Field>
      <Field id="aTitle" label="Title" wide>
        <input type="text" id="aTitle" maxLength={LIMITS.title} placeholder="Filled in from the link, or type your own" autoComplete="off"
          value={title} onChange={(e) => { setTitle(e.target.value); titleAuto.current = !e.target.value.trim(); }} />
      </Field>
      <Field id="aTopic" label="Topic">
        <input type="text" id="aTopic" maxLength={LIMITS.topic} list="topicList" placeholder="System design" autoComplete="off"
          value={topic} onChange={(e) => setTopic(e.target.value)} />
      </Field>
      <Field id="aMin" label="Read time (minutes)">
        <input type="number" id="aMin" min={1} max={600} placeholder="Estimated from the link" inputMode="numeric"
          value={mins} onChange={(e) => { setMins(e.target.value); minutesAuto.current = !e.target.value.trim(); }} />
      </Field>
      <Field id="aDue" label="Due date" hint="Leave empty to schedule it after the last article.">
        <input type="date" id="aDue" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <div className="row-actions">
        <button className="btn solid" type="submit">Add to ledger</button>
        <span className="err" role="alert">{err}</span>
      </div>
    </form>
  );
}

/* ---------------- New plan ---------------- */

export function NewPlan({ onCreated }: { onCreated: () => void }) {
  const { state, plan, today, createPlan } = useLedgerApi();
  const [name, setName] = useState(() => suggestName());
  const [start, setStart] = useState(() => suggestStart());
  const [days, setDays] = useState("30");
  const [seed, setSeed] = useState<PlanSeed>("empty");
  const [err, setErr] = useState("");

  function suggestStart() {
    const s = addDays(planEnd(plan), 1);
    return s < today ? today : s;
  }
  function suggestName() {
    let n = parseISO(suggestStart())!.toLocaleDateString(undefined, { month: "long", year: "numeric" }) + " reading";
    for (let i = 2; state.plans.some((p) => p.name.toLowerCase() === n.toLowerCase()); i++) n = n.replace(/( \(\d+\))?$/, ` (${i})`);
    return n;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const n = name.trim(), d = Number(days);
    if (!n) { setErr("Give the plan a name."); return; }
    if (!parseISO(start)) { setErr("Pick a start date."); return; }
    if (!validDays(d)) { setErr("Length must be a whole number from 1 to 365 days."); return; }
    if (state.plans.some((p) => p.name.toLowerCase() === n.toLowerCase())) { setErr("You already have a plan with that name."); return; }
    createPlan({ name: n, start, days: d, seed });
    onCreated();
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field id="npName" label="Plan name">
        <input type="text" id="npName" maxLength={LIMITS.planName} placeholder="November reading" autoComplete="off" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="npStart" label="Start date"><input type="date" id="npStart" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field id="npDays" label="Length in days"><input type="number" id="npDays" min={1} max={365} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      <Field id="npSeed" label="Articles to start with" wide>
        <select id="npSeed" value={seed} onChange={(e) => setSeed(e.target.value as PlanSeed)}>
          <option value="empty">Empty plan, I&apos;ll add my own</option>
          <option value="carry">Carry over unread articles from the current plan</option>
          <option value="favorites">My favourite articles</option>
          <option value="starter">Backend &amp; AI starter list (15 articles)</option>
        </select>
      </Field>
      <div className="row-actions">
        <button className="btn solid" type="submit">Create plan</button>
        <span className="err" role="alert">{err}</span>
      </div>
    </form>
  );
}

/* ---------------- Plan settings ---------------- */

export function PlanSettings({ onSaved }: { onSaved: () => void }) {
  const { state, plan, updatePlan, deletePlan } = useLedgerApi();
  const [name, setName] = useState(plan.name);
  const [start, setStart] = useState(plan.start);
  const [days, setDays] = useState(String(plan.days));
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const n = name.trim(), d = Number(days);
    if (!n) { setErr("Give the plan a name."); return; }
    if (!parseISO(start)) { setErr("Pick a start date."); return; }
    if (!validDays(d)) { setErr("Length must be a whole number from 1 to 365 days."); return; }
    if (state.plans.some((p) => p.id !== plan.id && p.name.toLowerCase() === n.toLowerCase())) { setErr("Another plan already uses that name."); return; }
    updatePlan({ name: n, start, days: d });
    onSaved();
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field id="pName" label="Plan name"><input type="text" id="pName" maxLength={LIMITS.planName} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field id="pStart" label="Start date"><input type="date" id="pStart" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field id="pDays" label="Length in days"><input type="number" id="pDays" min={1} max={365} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      <div className="row-actions">
        <button className="btn solid" type="submit">Save settings</button>
        {!confirming ? (
          <button className="btn danger" type="button" onClick={() => setConfirming(true)}>Delete this plan</button>
        ) : state.plans.length === 1 ? (
          <span className="err">This is your only plan. Create another one before deleting it.</span>
        ) : (
          <span className="confirm">Delete “{short(plan.name)}” and its notes? Favourites are kept.
            <button className="btn danger" type="button" autoFocus onClick={() => { setConfirming(false); deletePlan(); onSaved(); }}>Delete</button>
            <button className="btn ghost" type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        )}
        <span className="err" role="alert">{err}</span>
      </div>
    </form>
  );
}

/* ---------------- Backup ---------------- */

export function Backup() {
  const { state, today, restore, member } = useLedgerApi();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState<LedgerState | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const shown = editing ? text : JSON.stringify(state);

  async function copy() {
    const value = JSON.stringify(state);
    setEditing(false);
    try { await navigator.clipboard.writeText(value); setMsg("Copied. Paste it somewhere safe."); }
    catch { box.current?.focus(); box.current?.select(); setMsg("Text selected. Press Ctrl+C, or long-press and choose Copy."); }
  }

  function check() {
    setMsg(""); setPending(null);
    let parsed: LedgerState | null;
    try { parsed = sanitizeState(JSON.parse(shown), today); } catch { parsed = null; }
    if (!parsed) { setMsg("That text isn't a Redart backup. Paste the full text you copied earlier."); return; }
    setPending(parsed);
  }

  const articleCount = pending ? pending.plans.reduce((x, p) => x + p.articles.length, 0) : 0;
  return (
    <div className="form">
      <p className="hint wide">
        {member
          ? "Your ledger is saved to your account. You can still keep a copy: copy this text and store it somewhere safe. Restoring a backup replaces every plan and favourite in your account."
          : "Your ledger lives in this browser only. Copy this text and keep it somewhere safe (Telegram “Saved Messages” works well). To restore on any device, paste it in the box and press Restore. Restoring replaces everything here."}
      </p>
      <div className="field wide">
        <label className="visually-hidden" htmlFor="backupText">Backup text</label>
        <textarea ref={box} className="code" id="backupText" spellCheck={false} value={shown}
          onFocus={() => { if (!editing) { setText(JSON.stringify(state)); setEditing(true); } }}
          onChange={(e) => { setText(e.target.value); setEditing(true); }} />
      </div>
      <div className="row-actions">
        <button className="btn" type="button" onClick={copy}>Copy backup</button>
        <button className="btn" type="button" onClick={check}>Restore from box</button>
        {pending ? (
          <span className="confirm">
            Replace everything here with {plural(pending.plans.length, "plan")}, {plural(articleCount, "article")} and {plural(pending.favorites.length, "favourite")}?
            <button className="btn danger" type="button" onClick={() => { restore(pending); setPending(null); setEditing(false); }}>Replace</button>
            <button className="btn ghost" type="button" onClick={() => setPending(null)}>Cancel</button>
          </span>
        ) : null}
        <span className="hint" role="status">{msg}</span>
      </div>
    </div>
  );
}
