"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { todayISO, type ChallengeDetail } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { plural } from "@/lib/format";
import { useToast } from "../Toast";
import styles from "./Challenges.module.css";

interface Props { challenge: ChallengeDetail; signedIn: boolean; ended: boolean; inviteCode: string | null }

export function ChallengeActions({ challenge: c, signedIn, ended, inviteCode }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [track, setTrack] = useState(c.me?.track ?? "steady");
  const [board, setBoard] = useState(c.me?.showOnLeaderboard ?? false);
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const base = `/api/challenges/${c.slug}`;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); router.refresh(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't do that right now."); }
    finally { setBusy(false); }
  }

  const trackPicker = (
    <fieldset className={styles.tracks}>
      <legend className="visually-hidden">Your pace</legend>
      {c.tracks.map((t) => (
        <label key={t.key} className={styles.track}>
          <input type="radio" name="track" value={t.key} checked={track === t.key} onChange={() => setTrack(t.key)} />
          <span><b>{t.name}</b>{t.description} · {plural(t.targetArticles, "article")}</span>
        </label>
      ))}
    </fieldset>
  );

  if (!c.me) {
    if (ended) return <p className="hint">This challenge has finished. Its reading list is still here to browse.</p>;
    if (!signedIn) {
      return (
        <section className={styles.status}>
          <p>Join to get this reading list as a plan in your ledger, at a pace that suits you.</p>
          <p><Link className="btn solid" href={`/signin?next=/challenges/${c.slug}`}>Sign in to join</Link></p>
        </section>
      );
    }
    return (
      <section className={styles.section}>
        <h2>Choose your pace</h2>
        <div className={styles.joinBox}>
          {trackPicker}
          <label className="confirm">
            <input type="checkbox" checked={board} onChange={(e) => setBoard(e.target.checked)} />
            Show my progress on the leaderboard (you can change this later)
          </label>
          <div className={styles.row}>
            <button className="btn solid" type="button" disabled={busy} onClick={() => run(async () => {
              await api(`${base}/join?today=${todayISO()}`, { body: { track, showOnLeaderboard: board, inviteCode: inviteCode ?? undefined } });
              toast(`You're in. "${c.title}" is now your active plan.`);
            })}>{busy ? "Joining…" : "Join the challenge"}</button>
            <span className="hint">It becomes a plan in your ledger. You can switch pace or leave any time.</span>
          </div>
        </div>
      </section>
    );
  }

  const me = c.me;
  const pace = c.tracks.find((t) => t.key === me.track);
  return (
    <section className={styles.status} aria-label="Your progress">
      <div className={styles.row}>
        <b>You&apos;re reading at the {pace?.name.toLowerCase()} pace.</b>
        <span className="hint">{me.done} of {plural(me.total, "article")} read</span>
      </div>
      <div className={styles.bar} role="progressbar" aria-label="Your progress" aria-valuemin={0} aria-valuemax={me.total || 1} aria-valuenow={me.done}>
        <i style={{ width: `${me.total ? (me.done * 100) / me.total : 0}%` }} />
      </div>
      <div className={styles.row}>
        <button className="btn solid" type="button" onClick={() => run(async () => {
          await api(`/api/ledger/ops?today=${todayISO()}`, { body: { ops: [{ type: "plan.select", planId: me.planId }] } });
          router.push("/");
        })}>Open in my ledger</button>
        <label className="confirm">
          <input type="checkbox" checked={board} disabled={busy} onChange={(e) => {
            const v = e.target.checked;
            setBoard(v);
            run(async () => { await api(`${base}/me`, { method: "PATCH", body: { showOnLeaderboard: v } }); });
          }} />
          Show me on the leaderboard
        </label>
      </div>
      {!ended && (
        <details>
          <summary>Change pace</summary>
          <div className={styles.joinBox}>
            {trackPicker}
            <div className={styles.row}>
              <button className="btn" type="button" disabled={busy || track === me.track} onClick={() => run(async () => {
                const r = await api<{ added: number }>(`${base}/track?today=${todayISO()}`, { body: { track } });
                toast(r.added ? `Pace changed. ${plural(r.added, "article")} added, and unread ones rescheduled from today.` : "Pace changed. Unread articles were rescheduled from today.");
              })}>Switch pace</button>
              <span className="hint">Finished articles keep their dates. Nothing you added yourself is removed.</span>
            </div>
          </div>
        </details>
      )}
      <div className={styles.row}>
        {!confirmLeave ? <button className="btn ghost" type="button" onClick={() => setConfirmLeave(true)}>Leave challenge…</button> : (
          <span className="confirm">Leave? The plan stays in your ledger with everything you&apos;ve read.
            <button className="btn danger" type="button" disabled={busy} onClick={() => run(async () => { await api(`${base}/join`, { method: "DELETE", body: {} }); setConfirmLeave(false); toast("You've left the challenge. Your plan is still in your ledger."); })}>Leave</button>
            <button className="btn ghost" type="button" onClick={() => setConfirmLeave(false)}>Stay</button>
          </span>
        )}
      </div>
    </section>
  );
}
