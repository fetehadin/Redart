"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CHALLENGE_LIMITS, LIMITS, nextMonth, safeUrl, todayISO, TRACKS, trackTarget, urlKey, type CuratedArticle } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { inspectUrl } from "@/lib/inspect";
import { plural } from "@/lib/format";
import { Field } from "../forms";
import styles from "./Challenges.module.css";

export function NewChallengeForm({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [{ start: defStart, days: defDays }] = useState(() => nextMonth(todayISO()));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(defStart);
  const [days, setDays] = useState(String(defDays));
  const [topics, setTopics] = useState("");
  const [access, setAccess] = useState<"PUBLIC" | "INVITE">("PUBLIC");
  const [featured, setFeatured] = useState(false);
  const [articles, setArticles] = useState<CuratedArticle[]>([]);
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [linkErr, setLinkErr] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function addLink(e?: FormEvent) {
    e?.preventDefault();
    setLinkErr("");
    const url = safeUrl(link);
    if (!url) { setLinkErr("Paste a full link, like https://example.com/post."); return; }
    if (articles.some((a) => urlKey(a.url) === urlKey(url))) { setLinkErr("That article is already on the list."); return; }
    setAdding(true);
    const r = await inspectUrl(url);
    setAdding(false);
    if (r.status === "broken" || r.status === "invalid" || r.status === "blocked") { setLinkErr(r.message); return; }
    const host = new URL(url).hostname.replace(/^www\./, "");
    setArticles((list) => [...list, { url, title: (r.title || host).slice(0, LIMITS.title), minutes: Number.isInteger(r.minutes) ? r.minutes! : null, topic: "" }]);
    setLink("");
  }
  const move = (i: number, d: number) => setArticles((list) => {
    const next = [...list];
    const [a] = next.splice(i, 1);
    next.splice(i + d, 0, a!);
    return next;
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(""); setFields({}); setBusy(true);
    try {
      const body = {
        title, description, start, days: Number(days), access, featured: isAdmin ? featured : undefined, articles,
        topics: topics.split(",").map((t) => t.trim()).filter(Boolean).slice(0, CHALLENGE_LIMITS.topics),
      };
      const res = await api<{ slug: string; inviteCode: string | null }>(`/api/challenges?today=${todayISO()}`, { body });
      router.push(`/challenges/${res.slug}`);
    } catch (e) {
      if (e instanceof ApiError) { setErr(e.message); setFields(e.fields); } else setErr("Couldn't create the challenge. Try again.");
      setBusy(false);
    }
  }

  const n = Number(days) || 0;
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Start a challenge</h1>
      <p className={styles.intro}>Pick a theme, a month and a reading list. Readers choose their own pace when they join.</p>

      <div className={styles.section}>
        <h2>1. Reading list</h2>
        <form className={styles.row} onSubmit={addLink}>
          <label className="visually-hidden" htmlFor="newLink">Article link</label>
          <input id="newLink" type="url" placeholder="Paste an article link" value={link} onChange={(e) => setLink(e.target.value)} style={{ flex: "1 1 260px" }} />
          <button className="btn" type="submit" disabled={adding || !link.trim()}>{adding ? "Checking…" : "Add"}</button>
          <span className="err" role="alert">{linkErr}</span>
        </form>
        {articles.length ? (
          <ol className={styles.list}>
            {articles.map((a, i) => (
              <li key={a.url}>
                <span className="t">{a.title}</span>
                <span className={styles.sub}>{a.minutes ? `${a.minutes} min · ` : ""}{new URL(a.url).hostname}</span>
                <span className={styles.row}>
                  <button className="btn ghost" type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${a.title} up`}>▲</button>
                  <button className="btn ghost" type="button" disabled={i === articles.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${a.title} down`}>▼</button>
                  <button className="btn ghost" type="button" onClick={() => setArticles((l) => l.filter((x) => x.url !== a.url))} aria-label={`Remove ${a.title}`}>Remove</button>
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="hint">Add the articles in the order you&apos;d read them. Lighter paces take the ones at the top.</p>}
        {fields.articles ? <p className="err">{fields.articles}</p> : null}
      </div>

      <form className={styles.section} onSubmit={submit} noValidate>
        <h2>2. Details</h2>
        <Field id="cTitle" label="Title" maxLength={CHALLENGE_LIMITS.title} placeholder="November: Distributed systems" value={title} error={fields.title} onChange={(e) => setTitle(e.target.value)} />
        <div className="field" style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
          <label className="lbl" htmlFor="cDesc">What it&apos;s about</label>
          <textarea id="cDesc" rows={3} maxLength={CHALLENGE_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className={styles.row}>
          <Field id="cStart" label="Starts" type="date" value={start} error={fields.start} onChange={(e) => setStart(e.target.value)} />
          <Field id="cDays" label="Days" type="number" min={CHALLENGE_LIMITS.minDays} max={CHALLENGE_LIMITS.maxDays} value={days} error={fields.days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <Field id="cTopics" label="Topics" placeholder="Postgres, Caching" hint="Separate with commas. Readers who like these topics see the challenge first." value={topics} onChange={(e) => setTopics(e.target.value)} />
        <fieldset className={styles.tracks} style={{ marginBottom: 14 }}>
          <legend className="lbl">Who can join</legend>
          <label className={styles.track}><input type="radio" name="access" checked={access === "PUBLIC"} onChange={() => setAccess("PUBLIC")} /><span><b>Anyone</b>Listed on the challenges page.</span></label>
          <label className={styles.track}><input type="radio" name="access" checked={access === "INVITE"} onChange={() => setAccess("INVITE")} /><span><b>Invite link only</b>For a team or a group of friends.</span></label>
        </fieldset>
        {isAdmin ? <label className="confirm" style={{ marginBottom: 14 }}><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /> Feature it as a Redart pick</label> : null}
        {n > 0 && articles.length ? (
          <p className="hint">Paces: {TRACKS.map((t) => `${t.name} ${plural(Math.min(trackTarget(t.rate, n), articles.length), "article")}`).join(" · ")}</p>
        ) : null}
        <p className="err" role="alert">{err}</p>
        <button className="btn solid" type="submit" disabled={busy || !articles.length}>{busy ? "Creating…" : "Create challenge"}</button>
      </form>
    </section>
  );
}
