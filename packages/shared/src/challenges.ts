// Challenge pace tracks and how a challenge turns into a reader's plan. Pure, shared by web and API.
import { articleKey, diffDays, newArticle, planEnd, spread, type Article, type ISODate } from "./core";

export type TrackKey = "light" | "steady" | "deep";

export interface TrackSpec {
  key: TrackKey;
  name: string;
  description: string;
  /** Articles per day. */
  rate: number;
}

export const TRACKS: readonly TrackSpec[] = [
  { key: "light", name: "Light", description: "About 2 articles a week", rate: 2 / 7 },
  { key: "steady", name: "Steady", description: "One article every 2 days", rate: 1 / 2 },
  { key: "deep", name: "Deep", description: "An article a day", rate: 1 },
];

/** How many articles a track asks for over a challenge of `days` days (at least one). */
export const trackTarget = (rate: number, days: number) => Math.max(1, Math.round(rate * days));

export interface CuratedArticle { url: string; title: string; minutes: number | null; topic: string }

/** The first day a newcomer's schedule can use: the challenge start, or today if it already began. */
export function scheduleStart(challenge: { start: ISODate; days: number }, today: ISODate): ISODate {
  if (today <= challenge.start) return challenge.start;
  const end = planEnd(challenge);
  return today > end ? end : today;
}

/** Articles for someone joining: the first `target` curated ones, spread from the schedule start to the end. */
export function articlesForTrack(challenge: { start: ISODate; days: number }, curated: CuratedArticle[], target: number, today: ISODate): Article[] {
  const from = scheduleStart(challenge, today);
  const span = diffDays(from, planEnd(challenge)) + 1;
  const picked = curated.slice(0, target).map((c) =>
    newArticle({ title: c.title, url: c.url, topic: c.topic, minutes: c.minutes ?? 10, minutesAuto: c.minutes == null }, from));
  return spread(picked, from, span);
}

/**
 * Switching pace: add curated articles the plan doesn't have yet, up to the new target,
 * then spread every unread article from today to the end. Nothing the reader added is removed.
 */
export function retrack(
  challenge: { start: ISODate; days: number },
  plan: { articles: Article[] },
  curated: CuratedArticle[],
  target: number,
  today: ISODate,
): { added: Article[]; dues: Record<string, ISODate> } {
  const from = scheduleStart(challenge, today);
  const have = new Set(plan.articles.map(articleKey));
  const fromCurated = plan.articles.filter((a) => curated.some((c) => articleKey(c) === articleKey(a))).length;
  const added = curated
    .filter((c) => !have.has(articleKey(c)))
    .slice(0, Math.max(0, target - fromCurated))
    .map((c) => newArticle({ title: c.title, url: c.url, topic: c.topic, minutes: c.minutes ?? 10, minutesAuto: c.minutes == null }, from));
  const unread = [...plan.articles.filter((a) => !a.done), ...added].map((a) => ({ id: a.id, due: a.due }));
  const span = diffDays(from, planEnd(challenge)) + 1;
  spread(unread, from, span);
  const dues = Object.fromEntries(unread.map((a) => [a.id, a.due]));
  return { added: added.map((a) => ({ ...a, due: dues[a.id]! })), dues };
}

export type ChallengeWhen = "current" | "upcoming" | "past";
export function challengeWhen(c: { start: ISODate; days: number }, today: ISODate): ChallengeWhen {
  if (today < c.start) return "upcoming";
  return today > planEnd(c) ? "past" : "current";
}

/** First day of next month and that month's length: the default for a new challenge. */
export function nextMonth(today: ISODate): { start: ISODate; days: number } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const start = `${ny}-${String(nm).padStart(2, "0")}-01`;
  const following = nm === 12 ? `${ny + 1}-01-01` : `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
  return { start, days: diffDays(start, following) };
}

/** URL-safe slug from a title: "October: Distributed Systems!" -> "october-distributed-systems". */
export function slugify(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "challenge";
}

