"use client";
import { useState, type KeyboardEvent } from "react";
import { articleKey, LIMITS, parseISO, safeUrl, scheduleStatus, urlKey, type Article } from "@redart/shared";
import { fmtDate } from "@/lib/format";
import { cx } from "@/lib/cx";
import { useLedgerApi } from "./LedgerContext";
import type { Filter } from "./Toolbar";
import s from "./Ledger.module.css";

const WARN_STATES = new Set(["restricted", "timeout", "unreachable"]);
const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

function matches(item: { title: string; topic?: string; url?: string }, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return item.title.toLowerCase().includes(q) || (item.topic || "").toLowerCase().includes(q) || (item.url || "").toLowerCase().includes(q);
}

function Empty({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return <div className={s.empty}><h3>{title}</h3><p>{text}</p>{children}</div>;
}

export function ArticleList({ filter, query, onAddArticle }: { filter: Filter; query: string; onAddArticle: () => void }) {
  const { plan } = useLedgerApi();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (filter === "fav") return <section className={s.ledger} id="ledger" aria-label="Favourite articles" tabIndex={-1}><Favorites query={query} /></section>;

  let body: React.ReactNode;
  if (!plan.articles.length) {
    body = (
      <Empty title="This ledger is empty" text="Paste an article link in “Add an article” below. Redart checks the link and estimates the read time for you.">
        <button className="btn" type="button" onClick={onAddArticle}>Add an article</button>
      </Empty>
    );
  } else {
    const rows = plan.articles
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => (filter === "all" || (filter === "done" ? a.done : !a.done)) && matches(a, query));
    if (!rows.length) {
      body = query ? <Empty title="No matches" text={`Nothing in this plan matches “${query}”.`} />
        : filter === "done" ? <Empty title="Nothing read yet" text="Tick an article when you finish it and it shows up here." />
        : <Empty title="Everything is read" text="Every article in this plan is ticked off. Start a new plan when you're ready." />;
    } else {
      body = rows.map(({ a, i }) => editingId === a.id
        ? <EditRow key={a.id} a={a} index={i} onDone={() => { setEditingId(null); focusLater("cb-" + a.id); }} />
        : <ArticleRow key={a.id} a={a} index={i} searching={!!query}
            confirming={confirmId === a.id}
            onEdit={() => { setConfirmId(null); setEditingId(a.id); }}
            onConfirm={(on) => setConfirmId(on ? a.id : null)} />);
    }
  }
  return <section className={s.ledger} id="ledger" aria-label="Articles" tabIndex={-1}>{body}</section>;
}

function LinkBadge({ a, checking }: { a: Article; checking: boolean }) {
  if (!a.url) return <span className={cx(s.link, s.muted)}>No link</span>;
  if (checking) return <span className={cx(s.link, s.muted)}><span className="spin" aria-hidden="true" />Checking link…</span>;
  const l = a.link;
  if (!l) return <span className={cx(s.link, s.muted)}>Link not checked</span>;
  const when = "checked " + new Date(l.checkedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  switch (l.status) {
    case "ok": return <span className={cx(s.link, s.ok)} title={when}>✓ Link works</span>;
    case "restricted": return <span className={cx(s.link, s.warn)} title={`${l.message} (${when})`}>? Site blocked the check</span>;
    case "timeout": case "unreachable": return <span className={cx(s.link, s.warn)} title={`${l.message} (${when})`}>! Site not responding</span>;
    default: return <span className={cx(s.link, s.bad)} title={`${l.message} (${when})`}>✕ Broken link</span>;
  }
}

interface RowProps {
  a: Article; index: number; searching: boolean; confirming: boolean;
  onEdit: () => void; onConfirm: (on: boolean) => void;
}

function ArticleRow({ a, index, searching, confirming, onEdit, onConfirm }: RowProps) {
  const { plan, today, checking, favKeys, toggleDone, toggleFav, setDue, setNotes, move, removeArticle, recheck } = useLedgerApi();
  const sch = scheduleStatus(a, today);
  const fav = favKeys.has(articleKey(a));
  const isChecking = checking.has(a.id);
  const showLinkMsg = a.link && a.link.status !== "ok" && !isChecking;

  return (
    <div className={cx(s.row, a.done && s.done)} data-id={a.id}>
      <div className={s.num}>{String(index + 1).padStart(2, "0")}</div>
      <div className={s.main}>
        <div className={s.ttl}>
          <input type="checkbox" id={"cb-" + a.id} aria-label={`Mark “${a.title}” as read`} checked={a.done} onChange={(e) => toggleDone(a.id, e.target.checked)} />
          {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : <span className={s.t}>{a.title}</span>}
          <button className={s.star} type="button" aria-pressed={fav} aria-label={fav ? "Remove from favourites" : "Save to favourites"}
            title={fav ? "Remove from favourites" : "Save to favourites"} onClick={() => toggleFav(a)}>{fav ? "★" : "☆"}</button>
        </div>
        <div className={s.meta}>
          <span className={cx(s.status, s[sch.key])}>{sch.label}</span>
          {a.topic ? <span className={s.chip}>{a.topic}</span> : null}
          <span className="mono" title={a.minutesAuto ? "Estimated from the article's length" : "Set by you"}>{`${a.minutes} min read${a.minutesAuto ? " (est.)" : ""}`}</span>
          <LinkBadge a={a} checking={isChecking} />
          <label className="mono" htmlFor={"due-" + a.id}>due</label>
          <input type="date" id={"due-" + a.id} aria-label="Due date" value={a.due}
            onChange={(e) => { if (parseISO(e.target.value)) setDue(a.id, e.target.value); }} />
          {a.done && a.doneAt ? <span className="mono">read {fmtDate(a.doneAt)}</span> : null}
          {showLinkMsg ? <span className={cx(s.linkMsg, WARN_STATES.has(a.link!.status) && s.warn)}>{a.link!.message}</span> : null}
        </div>
        <div className={s.notes}>
          <textarea id={"note-" + a.id} placeholder="Your note: what you learned, and one thing to apply…" aria-label={"Notes for " + a.title}
            maxLength={LIMITS.notes} value={a.notes} onChange={(e) => setNotes(a.id, e.target.value)} />
        </div>
      </div>
      {confirming ? (
        <div className={s.actions}>
          <span className="confirm">Remove?
            <button className={cx(s.icon, s.danger)} type="button" autoFocus onClick={() => { onConfirm(false); removeArticle(a.id); }}>Yes, remove</button>
            <button className={s.icon} type="button" onClick={() => onConfirm(false)}>Keep</button>
          </span>
        </div>
      ) : (
        <div className={s.actions}>
          <button className={s.icon} type="button" aria-label={"Edit " + a.title} onClick={onEdit}>Edit</button>
          {a.url ? <button className={s.icon} type="button" title="Check the link again" disabled={isChecking} onClick={() => recheck(a.id)}>Recheck</button> : null}
          <button className={s.icon} type="button" title="Move up" aria-label="Move up" disabled={index === 0 || searching} onClick={() => move(index, -1)}>▲</button>
          <button className={s.icon} type="button" title="Move down" aria-label="Move down" disabled={index === plan.articles.length - 1 || searching} onClick={() => move(index, 1)}>▼</button>
          <button className={s.icon} type="button" aria-label={"Remove " + a.title} onClick={() => onConfirm(true)}>Remove</button>
        </div>
      )}
    </div>
  );
}

function EditRow({ a, index, onDone }: { a: Article; index: number; onDone: () => void }) {
  const { plan, saveArticle } = useLedgerApi();
  const [title, setTitle] = useState(a.title);
  const [url, setUrl] = useState(a.url);
  const [topic, setTopic] = useState(a.topic);
  const [mins, setMins] = useState(String(a.minutes));
  const [err, setErr] = useState("");

  const save = () => {
    const t = title.trim();
    if (!t) { setErr("The title can't be empty."); focusLater("e-title-" + a.id); return; }
    let u = "";
    if (url.trim()) {
      u = safeUrl(url) ?? "";
      if (!u) { setErr("That link doesn't look right. Use a full address like https://example.com/post."); focusLater("e-url-" + a.id); return; }
    }
    const k = urlKey(u);
    if (k && plan.articles.some((x) => x.id !== a.id && urlKey(x.url) === k)) { setErr("Another article in this plan already uses this link."); focusLater("e-url-" + a.id); return; }
    const m = Number(mins);
    if (!Number.isFinite(m) || m < LIMITS.minMinutes || m > LIMITS.maxMinutes) { setErr("Read time must be between 1 and 600 minutes."); focusLater("e-min-" + a.id); return; }
    saveArticle(a, { title: t, url: u, topic: topic.trim(), minutes: Math.round(m) });
    onDone();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); save(); }
    if (e.key === "Escape") onDone();
  };
  const field = (id: string, label: string, input: React.ReactNode, wide = false) => (
    <div className={cx(s.field, wide && s.wide)}><label className="lbl" htmlFor={id}>{label}</label>{input}</div>
  );

  return (
    <div className={s.row} data-id={a.id} onKeyDown={onKey}>
      <div className={s.num}>{String(index + 1).padStart(2, "0")}</div>
      <div className={s.main}>
        <div className={s.edit}>
          {field("e-title-" + a.id, "Title", <input type="text" id={"e-title-" + a.id} autoFocus maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} />, true)}
          {field("e-url-" + a.id, "Link", <input type="url" id={"e-url-" + a.id} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />, true)}
          {field("e-topic-" + a.id, "Topic", <input type="text" id={"e-topic-" + a.id} maxLength={LIMITS.topic} list="topicList" value={topic} onChange={(e) => setTopic(e.target.value)} />)}
          {field("e-min-" + a.id, "Read time (min)", <input type="number" id={"e-min-" + a.id} min={1} max={600} inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} />)}
          <div className={cx(s.wide, "confirm")}>
            <button className="btn solid" type="button" onClick={save}>Save</button>
            <button className="btn" type="button" onClick={onDone}>Cancel</button>
            <span className="err" role="alert">{err}</span>
          </div>
        </div>
      </div>
      <div />
    </div>
  );
}

function Favorites({ query }: { query: string }) {
  const { state, plan, toggleFav, addFavToPlan } = useLedgerApi();
  if (!state.favorites.length) {
    return <Empty title="No favourites yet" text="Tap the ☆ next to any article to keep it here. Favourites stay with you across every plan, even after you delete one." />;
  }
  const favs = state.favorites.filter((f) => matches(f, query));
  if (!favs.length) return <Empty title="No matches" text={`No favourite matches “${query}”.`} />;
  const inPlan = new Set(plan.articles.map(articleKey));
  return favs.map((f, i) => (
    <div className={s.row} key={f.id}>
      <div className={s.num}>{String(i + 1).padStart(2, "0")}</div>
      <div className={s.main}>
        <div className={s.ttl}>
          {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer">{f.title}</a> : <span className={s.t}>{f.title}</span>}
          <button className={s.star} type="button" aria-pressed="true" aria-label="Remove from favourites" title="Remove from favourites" onClick={() => toggleFav(f)}>★</button>
        </div>
        <div className={s.meta}>
          {f.topic ? <span className={s.chip}>{f.topic}</span> : null}
          <span className="mono">{f.minutes} min read</span>
          <span className="mono">saved {fmtDate(f.savedAt, true)}</span>
        </div>
      </div>
      <div className={s.actions}>
        {inPlan.has(articleKey(f))
          ? <span className={s.icon}>In this plan</span>
          : <button className={s.icon} type="button" onClick={() => addFavToPlan(f)}>Add to this plan</button>}
      </div>
    </div>
  ));
}
