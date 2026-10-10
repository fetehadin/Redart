"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { NotificationItem } from "@redart/shared";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Avatar } from "../Avatar";
import { TimeAgo } from "./TimeAgo";
import { AddToPlanButton } from "./AddToPlanButton";
import { ArticleLine } from "./Feed";
import styles from "./Social.module.css";

function Text({ n }: { n: NotificationItem }) {
  switch (n.kind) {
    case "NEW_FOLLOWER": return <>started following you.</>;
    case "FOLLOW_REQUEST": return <>asked to follow you. <Link href="/people">Review requests</Link></>;
    case "FOLLOW_ACCEPTED": return <>accepted your follow request.</>;
    case "RECOMMENDATION": return <>recommended something for you.</>;
  }
}

export function Inbox({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const unread = items.some((n) => !n.read);
  // Seeing the inbox marks it read; the header badge updates on refresh.
  useEffect(() => {
    if (!unread) return;
    api("/api/notifications/read", { body: {} }).then(() => router.refresh(), () => {});
  }, [unread, router]);

  if (!items.length) {
    return <div className={styles.empty}><h2>Nothing new</h2><p>New followers, requests and recommendations sent to you show up here.</p></div>;
  }
  return (
    <ul className={styles.list}>
      {items.map((n) => (
        <li key={n.id} className={cx(styles.entry, !n.read && styles.unread)}>
          <Avatar name={n.actor.displayName} handle={n.actor.handle} size={36} />
          <div className={styles.body}>
            <p className={styles.line}>
              <Link href={`/u/${n.actor.handle}`} className={styles.actor}>{n.actor.displayName}</Link> <Text n={n} />
              <span className={styles.when}> · <TimeAgo iso={n.createdAt} /></span>
            </p>
            {n.kind === "RECOMMENDATION" ? (
              <>
                {n.recommendation.message ? <blockquote className={styles.message}>{n.recommendation.message}</blockquote> : null}
                <ArticleLine a={n.recommendation.article} />
                <div className={styles.actions}><AddToPlanButton article={n.recommendation.article} /></div>
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
