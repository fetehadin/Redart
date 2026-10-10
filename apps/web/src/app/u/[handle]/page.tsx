import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { FinishedItem, Page, PlanSummary, Profile, PublicFavorite } from "@redart/shared";
import { getCurrentUser, serverApi } from "@/lib/session";
import { monthOf, shortDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { FollowButton } from "@/components/people/FollowButton";
import { BlockButton } from "@/components/people/BlockButton";
import styles from "./Profile.module.css";

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const { data } = await serverApi<Profile>(`/api/users/${encodeURIComponent(handle)}`);
  return data ? { title: `${data.displayName} (@${data.handle})`, description: data.bio || `What @${data.handle} is reading on Redart.` } : { title: "Reader not found" };
}

export default async function ProfilePage({ params }: Params) {
  const { handle } = await params;
  const h = encodeURIComponent(handle);
  const [{ data: profile }, me] = await Promise.all([serverApi<Profile>(`/api/users/${h}`), getCurrentUser()]);
  if (!profile) notFound();

  const [plans, finished, favorites, challenges] = profile.canSeeReading
    ? await Promise.all([
        serverApi<{ items: PlanSummary[] }>(`/api/users/${h}/plans`),
        serverApi<Page<FinishedItem>>(`/api/users/${h}/finished?limit=10`),
        serverApi<Page<PublicFavorite>>(`/api/users/${h}/favorites?limit=10`),
        serverApi<{ items: { slug: string; title: string; start: string; days: number; track: string }[] }>(`/api/users/${h}/challenges`),
      ])
    : [null, null, null, null];

  const rel = profile.relationship;
  const year = new Date().getUTCFullYear();

  return (
    <article className={styles.page}>
      <header className={styles.head}>
        <Avatar name={profile.displayName} handle={profile.handle} size={72} />
        <div className={styles.id}>
          <h1>{profile.displayName}</h1>
          <p className={styles.handle}>
            @{profile.handle}
            {profile.visibility === "PRIVATE" ? <span className={styles.badge}>Private</span> : null}
            {rel?.followsYou === "accepted" ? <span className={styles.badge}>Follows you</span> : null}
          </p>
          {profile.bio ? <p className={styles.bio}>{profile.bio}</p> : null}
          <p className={styles.counts}>
            {profile.canSeeReading ? <Link href={`/u/${profile.handle}/followers`}><b>{profile.followers}</b> {profile.followers === 1 ? "follower" : "followers"}</Link> : <span><b>{profile.followers}</b> followers</span>}
            {" · "}
            {profile.canSeeReading ? <Link href={`/u/${profile.handle}/following`}><b>{profile.following}</b> following</Link> : <span><b>{profile.following}</b> following</span>}
            {" · "}joined {monthOf(profile.joinedAt)}
          </p>
        </div>
        <div className={styles.actions}>
          {rel?.self ? <Link className="btn" href="/settings">Edit profile</Link> : null}
          {rel && !rel.self ? <FollowButton handle={profile.handle} relationship={rel} isPrivate={profile.visibility === "PRIVATE"} /> : null}
          {rel && !rel.self ? <BlockButton handle={profile.handle} blocked={rel.blocked} /> : null}
          {!me ? <Link className="btn solid" href={`/signin?next=/u/${profile.handle}`}>Sign in to follow</Link> : null}
        </div>
      </header>

      {!profile.canSeeReading ? (
        <p className={styles.locked}>
          {!me ? `Sign in to see what @${profile.handle} is reading.`
            : rel?.blocked ? `You've blocked @${profile.handle}.`
            : rel?.following === "pending" ? `Your request is waiting. You'll see @${profile.handle}'s reading once they accept.`
            : `@${profile.handle}'s reading is private. Ask to follow to see it.`}
        </p>
      ) : (
        <>
          {profile.stats && (
            <section className={styles.stats} aria-label="Reading so far">
              <div><span className="lbl">This month</span><b>{plural(profile.stats.articlesThisMonth, "article")}</b><span>{profile.stats.minutesThisMonth} min of reading</span></div>
              <div><span className="lbl">All time</span><b>{plural(profile.stats.articlesRead, "article")}</b><span>{profile.stats.minutesRead} min of reading</span></div>
            </section>
          )}

          <section className={styles.section}>
            <h2>Plans</h2>
            {plans?.data?.items.length ? (
              <ul className={styles.plans}>
                {plans.data.items.map((p) => (
                  <li key={p.id}>
                    <div className={styles.planTop}><b>{p.name}</b><span>{shortDate(p.start, year)} · {plural(p.days, "day")}</span></div>
                    <div className={styles.bar} role="progressbar" aria-label={`${p.name} progress`} aria-valuemin={0} aria-valuemax={p.total || 1} aria-valuenow={p.done}>
                      <i style={{ width: `${p.total ? (p.done * 100) / p.total : 0}%` }} />
                    </div>
                    <span className={styles.sub}>{p.done} of {plural(p.total, "article")} read · {p.minutesDone} of {p.minutesAll} min</span>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">No plans to show yet.</p>}
          </section>

          {challenges?.data?.items.length ? (
            <section className={styles.section}>
              <h2>Challenges</h2>
              <ul className={styles.items}>
                {challenges.data.items.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/challenges/${c.slug}`}>{c.title}</Link>
                    <span className={styles.sub}>{c.track} pace · {shortDate(c.start, year)} · {plural(c.days, "day")}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={styles.section}>
            <h2>Recently finished</h2>
            {finished?.data?.items.length ? (
              <ul className={styles.items}>
                {finished.data.items.map((a) => (
                  <li key={a.id}>
                    {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : <span>{a.title}</span>}
                    <span className={styles.sub}>{shortDate(a.doneAt, year)} · {a.minutes} min{a.topic ? ` · ${a.topic}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">Nothing finished yet.</p>}
          </section>

          <section className={styles.section}>
            <h2>Favourites</h2>
            {favorites?.data?.items.length ? (
              <ul className={styles.items}>
                {favorites.data.items.map((f) => (
                  <li key={f.id}>
                    {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer">★ {f.title}</a> : <span>★ {f.title}</span>}
                    <span className={styles.sub}>{f.minutes} min{f.topic ? ` · ${f.topic}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">No favourites yet.</p>}
          </section>
        </>
      )}
    </article>
  );
}
