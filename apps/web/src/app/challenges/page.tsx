import type { Metadata } from "next";
import Link from "next/link";
import type { ChallengeSummary } from "@redart/shared";
import { getCurrentUser, serverApi } from "@/lib/session";
import { challengeDates } from "@/lib/challenges";
import { plural } from "@/lib/format";
import { cx } from "@/lib/cx";
import styles from "@/components/challenges/Challenges.module.css";

export const metadata: Metadata = { title: "Reading challenges" };

const TABS = [["current", "This month"], ["upcoming", "Upcoming"], ["past", "Past"]] as const;

export default async function ChallengesPage({ searchParams }: { searchParams: Promise<{ when?: string }> }) {
  const raw = (await searchParams).when;
  const when = raw === "upcoming" || raw === "past" ? raw : "current";
  const [me, { data }] = await Promise.all([getCurrentUser(), serverApi<{ items: ChallengeSummary[] }>(`/api/challenges?when=${when}`)]);
  const items = data?.items ?? [];
  const mine = new Set((me?.topics ?? []).map((t) => t.toLowerCase()));

  return (
    <section className={styles.page}>
      <div className={styles.top}>
        <div>
          <h1 className={styles.title}>Reading challenges</h1>
          <p className={styles.intro}>Read along with others for a month. Pick the pace that fits your life: light, steady or deep. Joining adds a plan to your ledger.</p>
        </div>
        {me ? <Link className="btn solid" href="/challenges/new">Start a challenge</Link> : <Link className="btn" href="/signin?next=/challenges">Sign in to join</Link>}
      </div>
      <nav className={styles.tabs} aria-label="When">
        {TABS.map(([key, label]) => <Link key={key} href={key === "current" ? "/challenges" : `/challenges?when=${key}`} aria-current={when === key ? "page" : undefined}>{label}</Link>)}
      </nav>
      {items.length ? (
        <ul className={styles.grid}>
          {items.map((c) => (
            <li key={c.slug} className={cx(styles.card, c.featured && styles.featured)}>
              {c.featured ? <span className={styles.tag}>Redart pick</span> : null}
              <h2><Link href={`/challenges/${c.slug}`}>{c.title}</Link></h2>
              <span className={styles.when}>{challengeDates(c)} · {plural(c.articleCount, "article")}</span>
              {c.description ? <p className={styles.desc}>{c.description}</p> : null}
              {c.topics.length ? <ul className={styles.chips}>{c.topics.map((t) => <li key={t} className={mine.has(t.toLowerCase()) ? styles.match : undefined}>{t}</li>)}</ul> : null}
              <div className={styles.foot}>
                <span>{plural(c.participants, "reader")}{c.access === "INVITE" ? " · invite only" : ""}</span>
                {c.joined ? <span className={styles.joinedTag}>You&apos;re in ✓</span> : <span>by @{c.createdBy.handle}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>
          {when === "current" ? "No challenges running right now. " : when === "upcoming" ? "Nothing scheduled yet. " : "No finished challenges yet. "}
          {me ? <Link href="/challenges/new">Start one</Link> : null}
        </p>
      )}
    </section>
  );
}
