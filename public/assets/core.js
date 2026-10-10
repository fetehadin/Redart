// Pure logic shared by the app and the tests. No DOM, no storage.

export const SCHEMA_VERSION = 2;
export const LIMITS = { title: 200, topic: 40, notes: 5000, planName: 60, minMinutes: 1, maxMinutes: 600, minDays: 1, maxDays: 365 };

/* ---------- dates: local calendar days as "YYYY-MM-DD" (no timezone drift) ---------- */
const pad = (n) => String(n).padStart(2, "0");
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseISO(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
// Math.round absorbs the 23/25-hour days around daylight-saving changes.
export const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const todayISO = (now = new Date()) => toISO(now);
export const planEnd = (p) => addDays(p.start, p.days - 1);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clampInt = (v, lo, hi, def) => {
  if (v === "" || v == null) return def;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

/* ---------- URLs ---------- */
/** Return an absolute http(s) URL string, adding https:// when missing, or null. */
export function safeUrl(raw) {
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
export function urlKey(raw) {
  const s = safeUrl(raw);
  if (!s) return null;
  const u = new URL(s);
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? "?" + new URLSearchParams(params).toString() : "";
  const path = u.pathname.replace(/\/+$/, "") || "";
  return u.hostname.replace(/^www\./, "").toLowerCase() + path + q;
}
/** Identity of an article for favourites and duplicates: its URL, or its title when it has no link. */
export const articleKey = (a) => urlKey(a.url) || "title:" + String(a.title || "").trim().toLowerCase();

/* ---------- scheduling ---------- */
/** Spread due dates evenly: first on the start day, last on the plan's final day. */
export function spread(list, start, days) {
  const n = list.length;
  if (!n) return list;
  const span = Math.max(0, days - 1);
  list.forEach((a, i) => { a.due = addDays(start, n === 1 ? 0 : Math.round((i * span) / (n - 1))); });
  return list;
}

/** Due date for a newly added article: after the latest one, at the plan's pace, within the plan. */
export function nextDueDate(plan, today) {
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

export function scheduleStatus(a, today) {
  if (a.done) return { key: "done", label: "Read" };
  if (a.due < today) return { key: "late", label: "Overdue" };
  if (a.due === today) return { key: "today", label: "Due today" };
  return { key: "next", label: "Upcoming" };
}

/** Numbers for the summary card. */
export function planStats(plan, today) {
  const A = plan.articles;
  const done = A.filter((a) => a.done);
  const minutesAll = A.reduce((x, a) => x + a.minutes, 0);
  const minutesDone = done.reduce((x, a) => x + a.minutes, 0);
  // Articles due today aren't missed yet, so they don't count against the pace.
  const expected = A.filter((a) => a.due < today).length;
  const dayNo = diffDays(plan.start, today) + 1;
  const end = planEnd(plan);
  const phase = dayNo < 1 ? "before" : today > end ? "after" : "during";
  let pace;
  if (!A.length) pace = { key: "none", text: "Add articles to set a pace" };
  else if (done.length === A.length) pace = { key: "ok", text: "All read. Well done." };
  else if (done.length > expected) pace = { key: "ok", text: `${done.length - expected} ahead of schedule` };
  else if (done.length < expected) pace = { key: "behind", text: `${expected - done.length} behind schedule` };
  else pace = { key: "ok", text: "On schedule" };
  const next = A.filter((a) => !a.done).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
  return { total: A.length, done: done.length, minutesAll, minutesDone, expected, dayNo, phase, end, pace, next };
}

/* ---------- link check results ---------- */
const LINK_STATES = new Set(["ok", "broken", "restricted", "unreachable", "timeout", "invalid", "blocked"]);
export function sanitizeLink(l) {
  if (!l || typeof l !== "object" || !LINK_STATES.has(l.status)) return null;
  return {
    status: l.status,
    httpStatus: Number.isInteger(l.httpStatus) ? l.httpStatus : null,
    message: typeof l.message === "string" ? l.message.slice(0, 300) : "",
    checkedAt: typeof l.checkedAt === "string" && !Number.isNaN(Date.parse(l.checkedAt)) ? l.checkedAt : new Date(0).toISOString(),
  };
}
export const LINK_STALE_DAYS = 7;
export function linkIsStale(a, now = Date.now()) {
  if (!a.url) return false;
  if (!a.link) return true;
  return now - Date.parse(a.link.checkedAt) > LINK_STALE_DAYS * 86400000;
}

/* ---------- state ---------- */
export function newArticle(fields, start) {
  return {
    id: uid(),
    title: String(fields.title || "").trim().slice(0, LIMITS.title),
    url: safeUrl(fields.url) || "",
    topic: String(fields.topic || "").trim().slice(0, LIMITS.topic),
    minutes: clampInt(fields.minutes, LIMITS.minMinutes, LIMITS.maxMinutes, 10),
    minutesAuto: !!fields.minutesAuto,
    due: parseISO(fields.due) ? fields.due : start,
    done: false,
    doneAt: null,
    notes: "",
    link: null,
  };
}

export function articlesFromRows(rows, start, days) {
  return spread(rows.map((r) => newArticle({ title: r[0], url: r[1], topic: r[2], minutes: r[3] }, start)), start, days);
}

/**
 * Validate anything that comes from storage or a pasted backup.
 * Accepts the v1 format (from the first artifact) and v2. Returns null when unusable.
 */
export function sanitizeState(o, today) {
  if (!o || typeof o !== "object" || !Array.isArray(o.plans)) return null;
  const plans = [];
  const seenPlanIds = new Set();
  for (const p of o.plans) {
    if (!p || typeof p !== "object") continue;
    const start = parseISO(p.start) ? p.start : today;
    const days = clampInt(p.days, LIMITS.minDays, LIMITS.maxDays, 30);
    const seenArticleIds = new Set();
    const articles = (Array.isArray(p.articles) ? p.articles : [])
      .filter((a) => a && typeof a.title === "string" && a.title.trim())
      .map((a) => {
        let id = typeof a.id === "string" && a.id ? a.id : uid();
        if (seenArticleIds.has(id)) id = uid();
        seenArticleIds.add(id);
        return {
          id,
          title: a.title.trim().slice(0, LIMITS.title),
          url: safeUrl(a.url) || "",
          topic: typeof a.topic === "string" ? a.topic.trim().slice(0, LIMITS.topic) : "",
          minutes: clampInt(a.minutes, LIMITS.minMinutes, LIMITS.maxMinutes, 10),
          minutesAuto: !!a.minutesAuto,
          due: parseISO(a.due) ? a.due : start,
          done: !!a.done,
          doneAt: a.done && parseISO(a.doneAt) ? a.doneAt : null,
          notes: typeof a.notes === "string" ? a.notes.slice(0, LIMITS.notes) : "",
          link: sanitizeLink(a.link),
        };
      });
    let id = typeof p.id === "string" && p.id ? p.id : uid();
    if (seenPlanIds.has(id)) id = uid();
    seenPlanIds.add(id);
    const name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, LIMITS.planName) : "Untitled plan";
    plans.push({ id, name, start, days, articles });
  }
  if (!plans.length) return null;
  const favorites = [];
  const favKeys = new Set();
  for (const f of Array.isArray(o.favorites) ? o.favorites : []) {
    if (!f || typeof f.title !== "string" || !f.title.trim()) continue;
    const fav = {
      id: typeof f.id === "string" && f.id ? f.id : uid(),
      title: f.title.trim().slice(0, LIMITS.title),
      url: safeUrl(f.url) || "",
      topic: typeof f.topic === "string" ? f.topic.trim().slice(0, LIMITS.topic) : "",
      minutes: clampInt(f.minutes, LIMITS.minMinutes, LIMITS.maxMinutes, 10),
      savedAt: parseISO(f.savedAt) ? f.savedAt : today,
    };
    const k = articleKey(fav);
    if (favKeys.has(k)) continue;
    favKeys.add(k);
    favorites.push(fav);
  }
  const theme = ["light", "dark", "system"].includes(o.prefs?.theme) ? o.prefs.theme : "system";
  const active = plans.some((p) => p.id === o.active) ? o.active : plans[0].id;
  return { version: SCHEMA_VERSION, active, plans, favorites, prefs: { theme } };
}

export function favoriteFromArticle(a, today) {
  return { id: uid(), title: a.title, url: a.url, topic: a.topic, minutes: a.minutes, savedAt: today };
}
