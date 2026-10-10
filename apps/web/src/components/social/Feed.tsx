"use client";
import Link from "next/link";
import { useState } from "react";
import type { ArticleRef, FeedItem, Page } from "@redart/shared";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { Avatar } from "../Avatar";
import { TimeAgo } from "./TimeAgo";
import { AddToPlanButton } from "./AddToPlanButton";
import styles from "./Social.module.css";

function ArticleLine({ a }: { a: ArticleRef }) {
  return (
    <div className={styles.article}>
      {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : <span>{a.title}</span>}
      <span className={styles.meta}>{[a.minutes ? `${a.minutes} min` : null, a.topic || null, a.url ? new URL(a.url).hostname.replace(/^www\./, "") : null].filter(Boolean).join(" · ")}</span>
    </div>
  );
}

function What({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case "FINISHED": return <>finished reading{item.planName ? <> in <em>{item.planName}</em></> : null}</>;
    case "FAVORITED": return <>saved a favourite</>;
    case "RECOMMENDED": return <>recommends</>;
    case "STARTED_PLAN": return <>started a plan: <em>{item.planName}</em>, {plural(item.articles, "article")} over {plural(item.days, "day")}</>;
    case "JOINED_CHALLENGE": return <>joined <Link href={`/challenges/${item.challenge.slug}`}>{item.challenge.title}</Link>{item.track ? ` (${item.track} pace)` : ""}</>;
  }
}

export function FeedEntry({ item }: { item: FeedItem }) {
  const article = "article" in item ? item.article : null;
  return (
    <li className={styles.entry}>
      <Avatar name={item.actor.displayName} handle={item.actor.handle} size={36} />
      <div className={styles.body}>
        <p className={styles.line}>
          <Link href={`/u/${item.actor.handle}`} className={styles.actor}>{item.actor.displayName}</Link> <What item={item} />
          <span className={styles.when}> · <TimeAgo iso={item.createdAt} /></span>
        </p>
        {item.kind === "RECOMMENDED" && item.message ? <blockquote className={styles.message}>{item.message}</blockquote> : null}
        {article ? <ArticleLine a={article} /> : null}
        {article?.url ? <div className={styles.actions}><AddToPlanButton article={article} /></div> : null}
      </div>
    </li>
  );
}

export function Feed({ initial }: { initial: Page<FeedItem> }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const next = await api<Page<FeedItem>>(`/api/feed?cursor=${cursor}`);
      setItems((list) => [...list, ...next.items.filter((i) => !list.some((x) => x.id === i.id))]);
      setCursor(next.nextCursor);
    } finally { setBusy(false); }
  }
  return (
    <>
      <ul className={styles.list}>{items.map((i) => <FeedEntry key={i.id} item={i} />)}</ul>
      {cursor ? <p className={styles.more}><button className="btn" type="button" disabled={busy} onClick={more}>{busy ? "Loading…" : "Show older"}</button></p> : null}
    </>
  );
}

export { ArticleLine };
