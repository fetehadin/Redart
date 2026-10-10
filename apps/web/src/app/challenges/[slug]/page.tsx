import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { challengeWhen, todayISO, type ChallengeDetail, type LeaderboardRow } from "@redart/shared";
import { getCurrentUser, serverApi } from "@/lib/session";
import { challengeDates } from "@/lib/challenges";
import { plural } from "@/lib/format";
import { ChallengeActions } from "@/components/challenges/ChallengeActions";
import styles from "@/components/challenges/Challenges.module.css";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ invite?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data } = await serverApi<ChallengeDetail>(`/api/challenges/${encodeURIComponent((await params).slug)}`);
  return data ? { title: data.title, description: data.description || undefined } : { title: "Challenge not found" };
}

export default async function ChallengePage({ params, searchParams }: Props) {
  const slug = encodeURIComponent((await params).slug);
  const invite = (await searchParams).invite;
  const q = invite ? `?invite=${encodeURIComponent(invite)}` : "";
  const [me, { data: c }, board] = await Promise.all([
    getCurrentUser(),
    serverApi<ChallengeDetail>(`/api/challenges/${slug}${q}`),
    serverApi<{ items: LeaderboardRow[] }>(`/api/challenges/${slug}/leaderboard${q}`),
  ]);
  if (!c) notFound();
  const when = challengeWhen(c, todayISO());

  return (
    <article className={styles.page}>
      <p><Link href="/challenges">← All challenges</Link></p>
      <header className={styles.hero}>
        {c.featured ? <span className={styles.tag}>Redart pick</span> : null}
        <h1>{c.title}</h1>
        <span className={styles.when}>
          {challengeDates(c)} · {plural(c.days, "day")} · {plural(c.participants, "reader")} · by <Link href={`/u/${c.createdBy.handle}`}>@{c.createdBy.handle}</Link>
          {when === "past" ? " · finished" : when === "upcoming" ? " · starts soon" : ""}
        </span>
        {c.description ? <p>{c.description}</p> : null}
        {c.topics.length ? <ul className={styles.chips}>{c.topics.map((t) => <li key={t}>{t}</li>)}</ul> : null}
        {c.inviteCode ? (
          <div>
            <span className="lbl">Invite link (only you can see this)</span>
            <p className={styles.invite}>{`/challenges/${c.slug}?invite=${c.inviteCode}`}</p>
          </div>
        ) : null}
      </header>

      <ChallengeActions challenge={c} signedIn={!!me} ended={when === "past"} inviteCode={invite ?? null} />

      <section className={styles.section}>
        <h2>The reading list</h2>
        <p className="hint">Your pace decides how many of these go into your plan, starting from the top. You can add your own articles too.</p>
        <ol className={styles.list}>
          {c.articles.map((a) => (
            <li key={a.url}>
              <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
              <span className={styles.sub}>{[a.minutes ? `${a.minutes} min` : null, a.topic || null].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <h2>Leaderboard</h2>
        {board.data?.items.length ? (
          <table className={styles.board}>
            <thead><tr><th scope="col">#</th><th scope="col">Reader</th><th scope="col">Read</th><th scope="col">Pace</th></tr></thead>
            <tbody>
              {board.data.items.map((r) => (
                <tr key={r.user.handle}>
                  <td className={styles.num}>{r.rank}</td>
                  <td><Link href={`/u/${r.user.handle}`}>{r.user.displayName}</Link></td>
                  <td className={styles.num}>{r.done} · {r.minutes} min</td>
                  <td>{r.track}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="hint">Nobody has chosen to show their progress yet. It&apos;s opt-in, so it&apos;s fine to read quietly.</p>}
      </section>
    </article>
  );
}
