import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { FeedItem, Page } from "@redart/shared";
import { getCurrentUser, serverApi } from "@/lib/session";
import { Feed } from "@/components/social/Feed";
import styles from "@/components/social/Social.module.css";

export const metadata: Metadata = { title: "Feed" };

export default async function FeedPage() {
  if (!(await getCurrentUser())) redirect("/signin?next=/feed");
  const { data } = await serverApi<Page<FeedItem> & { following: number }>("/api/feed");
  const feed = data ?? { items: [], nextCursor: null, following: 0 };
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>What your people are reading</h1>
      {feed.items.length ? <Feed initial={feed} /> : (
        <div className={styles.empty}>
          <h2>{feed.following ? "Quiet so far" : "Nobody to follow yet"}</h2>
          <p>{feed.following
            ? "When the readers you follow finish an article, save a favourite or recommend something, it shows up here."
            : "Follow a few readers to see what they're reading here."}</p>
          <Link className="btn solid" href="/people">Find readers</Link>
        </div>
      )}
    </section>
  );
}
