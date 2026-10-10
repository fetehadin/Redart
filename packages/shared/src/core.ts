// Pure logic shared by the web app and the API. No DOM, no storage, no Node-only APIs.

export const SCHEMA_VERSION = 2;
export const LIMITS = {
  title: 200, topic: 40, notes: 5000, planName: 60,
  minMinutes: 1, maxMinutes: 600, minDays: 1, maxDays: 365,
} as const;

/** A local calendar day, "YYYY-MM-DD". */
export type ISODate = string;
export type Theme = "light" | "dark" | "system";
export type LinkStatus = "ok" | "broken" | "restricted" | "unreachable" | "timeout" | "invalid" | "blocked";

export interface LinkCheck {
  status: LinkStatus;
  httpStatus: number | null;
  message: string;
  checkedAt: string; // ISO timestamp
}

export interface Article {
  id: string;
  title: string;
  url: string; // "" when the article has no link
  topic: string;
  minutes: number;
  minutesAuto: boolean; // estimated from the page, so link checks may refine it
  due: ISODate;
  done: boolean;
  doneAt: ISODate | null;
  notes: string;
  link: LinkCheck | null;
}

export interface Plan {
  id: string;
  name: string;
  start: ISODate;
  days: number;
  articles: Article[];
  /** Members only: whether followers can see this plan. Missing means shared. */
  shared?: boolean;
}

export interface Favorite {
  id: string;
  title: string;
  url: string;
  topic: string;
  minutes: number;
  savedAt: ISODate;
}

export interface LedgerState {
  version: typeof SCHEMA_VERSION;
  active: string;
  plans: Plan[];
  favorites: Favorite[];
  prefs: { theme: Theme };
}

/* ---------- dates: local calendar days, so there is no timezone drift ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
export const toISO = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseISO(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
const mustParse = (s: ISODate): Date => {
  const d = parseISO(s);
  if (!d) throw new RangeError(`Invalid date: ${s}`);
  return d;
};
export const addDays = (s: ISODate, n: number): ISODate => { const d = mustParse(s); d.setDate(d.getDate() + n); return toISO(d); };
// Math.round absorbs the 23/25-hour days around daylight-saving changes.
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((mustParse(b).getTime() - mustParse(a).getTime()) / 86400000);
export const todayISO = (now = new Date()): ISODate => toISO(now);
export const planEnd = (p: Pick<Plan, "start" | "days">): ISODate => addDays(p.start, p.days - 1);

/** Random v4 UUID. Falls back to getRandomValues where randomUUID is missing (plain-http LAN addresses). */
export function uid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  if (v === "" || v == null) return def;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

/* ---------- URLs ---------- */
/** Return an absolute http(s) URL string, adding https:// when missing, or null. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.href;
  } catch { return null; }
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|igshid$|si$)/i;
/** Key used to spot the same article written two ways (http vs https, www, tracking params, trailing slash). */
export function urlKey(raw: unknown): string | null {
  const s = safeUrl(raw);
  if (!s) return null;
  const u = new URL(s);
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? "?" + new URLSearchParams(params).toString() : "";
  const path = u.pathname.replace(/\/+$/, "") || "";
  return u.hostname.replace(/^www\./, "").toLowerCase() + path + q;
}
/** Identity of an article for favourites and duplicates: its URL, or its title when it has no link. */
export const articleKey = (a: { url?: string; title?: string }): string =>
  urlKey(a.url) || "title:" + String(a.title || "").trim().toLowerCase();

/* ---------- scheduling ---------- */
/** Spread due dates evenly: first on the start day, last on the plan's final day. Mutates and returns `list`. */
export function spread<T extends { due?: ISODate }>(list: T[], start: ISODate, days: number): (T & { due: ISODate })[] {
  const n = list.length;
  const span = Math.max(0, days - 1);
  list.forEach((a, i) => { a.due = addDays(start, n === 1 ? 0 : Math.round((i * span) / (n - 1))); });
  return list as (T & { due: ISODate })[];
}

/** Due date for a newly added article: after the latest one, at the plan's pace, within the plan. */
export function nextDueDate(plan: Pick<Plan, "start" | "days"> & { articles: { due: ISODate }[] }, today: ISODate): ISODate {
  const end = planEnd(plan);
  const open = plan.articles;
  const floor = plan.start > today ? plan.start : today;
  if (!open.length) return floor > end ? end : floor;
  const last = open.reduce((m, a) => (a.due > m ? a.due : m), "");
  const gap = Math.max(1, Math.round((plan.days - 1) / Math.max(1, open.length)));
  let due = addDays(last, gap);
  if (due < floor) due = floor;
  if (due > end) due = end;
  return due;
}

export type ScheduleKey = "done" | "late" | "today" | "next";
export function scheduleStatus(a: Pick<Article, "done" | "due">, today: ISODate): { key: ScheduleKey; label: string } {
  if (a.done) return { key: "done", label: "Read" };
  if (a.due < today) return { key: "late", label: "Overdue" };
  if (a.due === today) return { key: "today", label: "Due today" };
  return { key: "next", label: "Upcoming" };
}

export interface PlanStats {
  total: number;
  done: number;
  minutesAll: number;
  minutesDone: number;
  expected: number;
  dayNo: number;
  phase: "before" | "during" | "after";
  end: ISODate;
  pace: { key: "none" | "ok" | "behind"; text: string };
  next: Article | null;
}

/** Numbers for the summary card. */
export function planStats(plan: Plan, today: ISODate): PlanStats {
  const A = plan.articles;
  const done = A.filter((a) => a.done);
  const minutesAll = A.reduce((x, a) => x + a.minutes, 0);
  const minutesDone = done.reduce((x, a) => x + a.minutes, 0);
  // Articles due today aren't missed yet, so they don't count against the pace.
  const expected = A.filter((a) => a.due < today).length;
  const dayNo = diffDays(plan.start, today) + 1;
  const end = planEnd(plan);
  const phase = dayNo < 1 ? "before" : today > end ? "after" : "during";
  let pace: PlanStats["pace"];
  if (!A.length) pace = { key: "none", text: "Add articles to set a pace" };
  else if (done.length === A.length) pace = { key: "ok", text: "All read. Well done." };
  else if (done.length > expected) pace = { key: "ok", text: `${done.length - expected} ahead of schedule` };
  else if (done.length < expected) pace = { key: "behind", text: `${expected - done.length} behind schedule` };
  else pace = { key: "ok", text: "On schedule" };
  const next = A.filter((a) => !a.done).sort((a, b) => a.due.localeCompare(b.due))[0] ?? null;
  return { total: A.length, done: done.length, minutesAll, minutesDone, expected, dayNo, phase, end, pace, next };
}

/* ---------- link check results ---------- */
const LINK_STATES = new Set<string>(["ok", "broken", "restricted", "unreachable", "timeout", "invalid", "blocked"]);
export function sanitizeLink(l: unknown): LinkCheck | null {
  if (!l || typeof l !== "object") return null;
  const o = l as Record<string, unknown>;
  if (typeof o.status !== "string" || !LINK_STATES.has(o.status)) return null;
  return {
    status: o.status as LinkStatus,
    httpStatus: Number.isInteger(o.httpStatus) ? (o.httpStatus as number) : null,
    message: typeof o.message === "string" ? o.message.slice(0, 300) : "",
    checkedAt: typeof o.checkedAt === "string" && !Number.isNaN(Date.parse(o.checkedAt)) ? o.checkedAt : new Date(0).toISOString(),
  };
}
export const LINK_STALE_DAYS = 7;
export function linkIsStale(a: Pick<Article, "url" | "link">, now = Date.now()): boolean {
  if (!a.url) return false;
  if (!a.link) return true;
  return now - Date.parse(a.link.checkedAt) > LINK_STALE_DAYS * 86400000;
}

/* ---------- constructors ---------- */
export interface ArticleFields {
  title?: unknown; url?: unknown; topic?: unknown; minutes?: unknown; minutesAuto?: unknown; due?: unknown;
}
export function newArticle(fields: ArticleFields, start: ISODate): Article {
  return {
    id: uid(),
    title: String(fields.title || "").trim().slice(0, LIMITS.title),
    url: safeUrl(fields.url) || "",
    topic: String(fields.topic || "").trim().slice(0, LIMITS.topic),
    minutes: clampInt(fields.minutes, LIMITS.minMinutes, LIMITS.maxMinutes, 10),
    minutesAuto: !!fields.minutesAuto,
    due: parseISO(fields.due) ? (fields.due as ISODate) : start,
    done: false,
    doneAt: null,
    notes: "",
    link: null,
  };
}

/** Rows are [title, url, topic, minutes]. */
export type ArticleRow = readonly [string, string, string, number];
export function articlesFromRows(rows: readonly ArticleRow[], start: ISODate, days: number): Article[] {
  return spread(rows.map((r) => newArticle({ title: r[0], url: r[1], topic: r[2], minutes: r[3] }, start)), start, days);
}

export function favoriteFromArticle(a: Pick<Article, "title" | "url" | "topic" | "minutes">, today: ISODate): Favorite {
  return { id: uid(), title: a.title, url: a.url, topic: a.topic, minutes: a.minutes, savedAt: today };
}

/* ---------- validation of stored data and pasted backups ---------- */
type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object";
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Validate anything that comes from storage or a pasted backup.
 * Accepts the v1 format (from the first version) and v2. Returns null when unusable.
 */
export function sanitizeState(o: unknown, today: ISODate): LedgerState | null {
  if (!isObj(o) || !Array.isArray(o.plans)) return null;
  const plans: Plan[] = [];
  const seenPlanIds = new Set<string>();
  for (const p of o.plans as unknown[]) {
    if (!isObj(p)) continue;
    const start = parseISO(p.start) ? (p.start as ISODate) : today;
    const days = clampInt(p.days, LIMITS.minDays, LIMITS.maxDays, 30);
    const seenArticleIds = new Set<string>();
    const articles = (Array.isArray(p.articles) ? (p.articles as unknown[]) : [])
      .filter((a): a is Loose => isObj(a) && typeof a.title === "string" && !!a.title.trim())
      .map((a): Article => {
        let id = typeof a.id === "string" && a.id ? a.id : uid();
        if (seenArticleIds.has(id)) id = uid();
        seenArticleIds.add(id);
        return {
          id,
          title: str(a.title, LIMITS.title),
          url: safeUrl(a.url) || "",
          topic: str(a.topic, LIMITS.topic),
          minutes: clampInt(a.minutes, LIMITS.minMinutes, LIMITS.maxMinutes, 10),
          minutesAuto: !!a.minutesAuto,
          due: parseISO(a.due) ? (a.due as ISODate) : start,
          done: !!a.done,
          doneAt: a.done && parseISO(a.doneAt) ? (a.doneAt as ISODate) : null,
          notes: typeof a.notes === "string" ? a.notes.slice(0, LIMITS.notes) : "",
          link: sanitizeLink(a.link),
        };
      });
    let id = typeof p.id === "string" && p.id ? p.id : uid();
    if (seenPlanIds.has(id)) id = uid();
    seenPlanIds.add(id);
    const name = str(p.name, LIMITS.planName) || "Untitled plan";
    plans.push({ id, name, start, days, articles, ...(p.shared === false ? { shared: false } : {}) });
  }
  if (!plans.length) return null;
  const favorites: Favorite[] = [];
  const favKeys = new Set<string>();
  for (const f of Array.isArray(o.favorites) ? (o.favorites as unknown[]) : []) {
    if (!isObj(f) || typeof f.title !== "string" || !f.title.trim()) continue;
    const fav: Favorite = {
      id: typeof f.id === "string" && f.id ? f.id : uid(),
      title: str(f.title, LIMITS.title),
      url: safeUrl(f.url) || "",
      topic: str(f.topic, LIMITS.topic),
      minutes: clampInt(f.minutes, LIMITS.minMinutes, LIMITS.maxMinutes, 10),
      savedAt: parseISO(f.savedAt) ? (f.savedAt as ISODate) : today,
    };
    const k = articleKey(fav);
    if (favKeys.has(k)) continue;
    favKeys.add(k);
    favorites.push(fav);
  }
  const rawTheme = isObj(o.prefs) ? o.prefs.theme : undefined;
  const theme: Theme = rawTheme === "light" || rawTheme === "dark" ? rawTheme : "system";
  const active = plans.some((p) => p.id === o.active) ? (o.active as string) : plans[0]!.id;
  return { version: SCHEMA_VERSION, active, plans, favorites, prefs: { theme } };
}
