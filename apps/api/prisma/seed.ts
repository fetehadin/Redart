// Seeds a house account and two featured monthly challenges. Safe to run again: it updates in place.
// Usage: pnpm db:seed (reads DATABASE_URL from the environment or the repo's .env)
import path from "node:path";
import { randomBytes } from "node:crypto";
import { diffDays, nextMonth, STARTER, TRACKS, trackTarget, todayISO } from "@redart/shared";
import { createDb } from "../src/db";
import { hashPassword } from "../src/services/passwords";
import { toDbDate } from "../src/lib/dates";

try { process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env")); } catch { /* use the real environment */ }
const db = createDb(process.env.DATABASE_URL!);

const DISTRIBUTED = [
  ["Notes on Distributed Systems for Young Bloods — Jeff Hodges", "https://www.somethingsimilar.com/2013/01/14/notes-on-distributed-systems-for-young-bloods/", "Distributed systems", 15],
  ["The Log: What Every Software Engineer Should Know — Jay Kreps", "https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying", "Distributed systems", 45],
  ["Timeouts, Retries, and Backoff with Jitter — AWS Builders' Library", "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/", "Distributed systems", 18],
  ["Designing Robust and Predictable APIs with Idempotency — Stripe", "https://stripe.com/blog/idempotency", "System design", 12],
  ["Caching Challenges and Strategies — AWS Builders' Library", "https://aws.amazon.com/builders-library/caching-challenges-and-strategies/", "Caching", 20],
  ["Local-First Software — Ink & Switch", "https://www.inkandswitch.com/local-first/", "Architecture", 50],
  ["How Figma's Databases Team Lived to Tell the Scale", "https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/", "Postgres", 15],
  ["MonolithFirst — Martin Fowler", "https://martinfowler.com/bliki/MonolithFirst.html", "Architecture", 5],
] as const;

async function main() {
  const house = await db.user.upsert({
    where: { handle: "redart" },
    create: {
      handle: "redart", email: "challenges@redart.invalid", displayName: "Redart",
      bio: "Monthly reading challenges for engineers.", isAdmin: true,
      // Nobody signs in as the house account.
      passwordHash: await hashPassword(randomBytes(32).toString("hex")),
    },
    update: {},
  });

  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const thisMonth = { start: monthStart, days: diffDays(monthStart, nextMonth(today).start) };
  const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

  const challenges = [
    {
      slug: `backend-foundations-${thisMonth.start.slice(0, 7)}`,
      title: `${monthName(thisMonth.start)}: Backend foundations`,
      description: "Fifteen essays every backend engineer should know, from boring technology to Postgres at scale. Pick a pace that fits your month.",
      ...thisMonth,
      topics: ["Postgres", "Distributed systems", "Architecture", "Caching"],
      articles: STARTER.map(([title, url, topic, minutes]) => ({ title, url, topic, minutes })),
    },
    {
      slug: `distributed-systems-${nextMonth(today).start.slice(0, 7)}`,
      title: `${monthName(nextMonth(today).start)}: Distributed systems`,
      description: "Logs, retries, idempotency and caching: the ideas behind systems that keep working when parts of them don't.",
      ...nextMonth(today),
      topics: ["Distributed systems", "System design"],
      articles: DISTRIBUTED.map(([title, url, topic, minutes]) => ({ title, url, topic, minutes })),
    },
  ];

  for (const c of challenges) {
    const existing = await db.challenge.findUnique({ where: { slug: c.slug } });
    if (existing) { console.log(`exists: ${c.slug}`); continue; }
    await db.challenge.create({
      data: {
        slug: c.slug, title: c.title, description: c.description, start: toDbDate(c.start), days: c.days, topics: c.topics,
        featured: true, createdById: house.id,
        tracks: { create: TRACKS.map((t, i) => ({ key: t.key, name: t.name, description: t.description, targetArticles: Math.min(trackTarget(t.rate, c.days), c.articles.length), position: i })) },
        articles: { create: c.articles.map((a, i) => ({ ...a, position: i })) },
      },
    });
    console.log(`created: ${c.slug}`);
  }
}

main().finally(() => db.$disconnect());
