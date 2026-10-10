import Link from "next/link";
import { notFound } from "next/navigation";
import type { Profile, UserCard } from "@redart/shared";
import { serverApi } from "@/lib/session";
import { UserList } from "./UserList";
import styles from "./People.module.css";

/** A reader's followers or the people they follow. */
export async function FollowList({ handle, dir }: { handle: string; dir: "followers" | "following" }) {
  const h = encodeURIComponent(handle);
  const [{ data: profile }, list] = await Promise.all([
    serverApi<Profile>(`/api/users/${h}`),
    serverApi<{ items: UserCard[]; total: number }>(`/api/users/${h}/${dir}?limit=50`),
  ]);
  if (!profile) notFound();
  return (
    <section className={styles.page}>
      <p><Link href={`/u/${profile.handle}`}>← {profile.displayName}</Link></p>
      <h1 className={styles.title}>{dir === "followers" ? `People following @${profile.handle}` : `People @${profile.handle} follows`}</h1>
      {list.status === 403
        ? <p className="quiet">This list is private.</p>
        : <UserList users={list.data?.items ?? []} empty={dir === "followers" ? "No followers yet." : "Not following anyone yet."} />}
    </section>
  );
}
