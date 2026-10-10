"use client";
import { useEffect, useState } from "react";
import { RECOMMEND_MESSAGE_MAX, type UserCard } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { useToast } from "../Toast";
import styles from "./Recommend.module.css";

interface Props {
  handle: string;
  article: { title: string; url: string; minutes: number; topic: string };
  onClose: () => void;
}

/** Share an article with all followers (their feed) or one follower (their inbox). */
export function RecommendPanel({ handle, article, onClose }: Props) {
  const toast = useToast();
  const [followers, setFollowers] = useState<UserCard[] | null>(null);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ items: UserCard[] }>(`/api/users/${handle}/followers?limit=50`).then((r) => { if (live) setFollowers(r.items); }, () => { if (live) setFollowers([]); });
    return () => { live = false; };
  }, [handle]);

  async function send() {
    setBusy(true); setErr("");
    try {
      await api("/api/recommendations", { body: { ...article, message: message.trim() || undefined, toHandle: to || undefined } });
      toast(to ? `Sent to @${to}.` : "Shared with your followers.");
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't send it right now.");
      setBusy(false);
    }
  }

  const id = `rec-${article.url}`;
  return (
    <div className={styles.panel} role="group" aria-label={`Recommend ${article.title}`}>
      <div className={styles.field}>
        <label className="lbl" htmlFor={`${id}-to`}>Recommend to</label>
        <select id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">All my followers (shows in their feed)</option>
          {followers?.map((f) => <option key={f.handle} value={f.handle}>{f.displayName} (@{f.handle}), just them</option>)}
        </select>
        {followers && !followers.length ? <span className="hint">Nobody follows you yet, so this goes to your future followers&apos; feeds.</span> : null}
      </div>
      <div className={styles.field}>
        <label className="lbl" htmlFor={`${id}-msg`}>Why it&apos;s worth reading (optional)</label>
        <textarea id={`${id}-msg`} rows={2} maxLength={RECOMMEND_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="The part about retries finally made backoff click for me." />
      </div>
      <div className="confirm">
        <button className="btn solid" type="button" disabled={busy} onClick={send}>{busy ? "Sending…" : "Recommend"}</button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        <span className="err" role="alert">{err}</span>
      </div>
    </div>
  );
}
