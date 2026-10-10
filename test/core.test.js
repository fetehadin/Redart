import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, diffDays, parseISO, spread, nextDueDate, planStats, urlKey, articleKey, safeUrl, sanitizeState, linkIsStale, scheduleStatus,
} from "../public/assets/core.js";

test("dates: invalid days are rejected, month ends and leap years work", () => {
  assert.equal(parseISO("2026-02-30"), null);
  assert.equal(parseISO("2026-13-01"), null);
  assert.equal(parseISO("not a date"), null);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(diffDays("2026-03-01", "2026-04-01"), 31); // spans DST changes in many zones
});

test("spread puts the first article on day 1 and the last on the final day", () => {
  const list = Array.from({ length: 15 }, () => ({}));
  spread(list, "2026-10-10", 30);
  assert.equal(list[0].due, "2026-10-10");
  assert.equal(list[14].due, "2026-11-08");
  for (let i = 1; i < 15; i++) assert.ok(list[i].due >= list[i - 1].due);
  const one = [{}]; spread(one, "2026-10-10", 30); assert.equal(one[0].due, "2026-10-10");
  const tiny = Array.from({ length: 5 }, () => ({})); spread(tiny, "2026-10-10", 1);
  assert.ok(tiny.every((a) => a.due === "2026-10-10"));
});

test("next due date stays inside the plan and never in the past", () => {
  const plan = { start: "2026-10-01", days: 30, articles: [{ due: "2026-10-28" }] };
  assert.equal(nextDueDate(plan, "2026-10-10"), "2026-10-30"); // capped at plan end
  const empty = { start: "2026-10-01", days: 30, articles: [] };
  assert.equal(nextDueDate(empty, "2026-10-10"), "2026-10-10");
  const future = { start: "2026-11-01", days: 30, articles: [] };
  assert.equal(nextDueDate(future, "2026-10-10"), "2026-11-01");
  const old = { start: "2026-10-01", days: 30, articles: [{ due: "2026-10-02" }] };
  assert.ok(nextDueDate(old, "2026-10-20") >= "2026-10-20");
});

test("pace: ahead, behind, on schedule", () => {
  const p = { start: "2026-10-01", days: 10, articles: [
    { due: "2026-10-01", done: true, minutes: 10, title: "a" },
    { due: "2026-10-03", done: false, minutes: 5, title: "b" },
    { due: "2026-10-09", done: false, minutes: 5, title: "c" },
  ] };
  assert.equal(planStats(p, "2026-10-02").pace.key, "ok");
  assert.equal(planStats(p, "2026-10-05").pace.key, "behind");
  assert.equal(planStats(p, "2026-10-05").minutesDone, 10);
  assert.equal(planStats(p, "2026-09-20").phase, "before");
  assert.equal(planStats(p, "2026-10-20").phase, "after");
  assert.equal(scheduleStatus(p.articles[1], "2026-10-03").key, "today");
});

test("the same article written different ways has the same key", () => {
  const k = urlKey("https://www.example.com/post/?utm_source=telegram&b=2&a=1#top");
  assert.equal(k, urlKey("http://example.com/post?a=1&b=2"));
  assert.notEqual(urlKey("https://example.com/post?id=1"), urlKey("https://example.com/post?id=2"));
  assert.equal(articleKey({ title: "  My Note ", url: "" }), "title:my note");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("example.com"), "https://example.com/");
});

test("sanitizeState repairs bad data and accepts v1 backups", () => {
  assert.equal(sanitizeState(null, "2026-10-10"), null);
  assert.equal(sanitizeState({ plans: [] }, "2026-10-10"), null);
  const v1 = { version: 1, active: "x", plans: [{ id: "p1", name: "", start: "bad", days: 9999, articles: [
    { id: "a", title: "Ok", url: "javascript:alert(1)", minutes: -5, due: "2026-02-30", done: true, doneAt: "2026-10-01" },
    { id: "a", title: "Duplicate id", url: "example.com/x", minutes: "12" },
    { title: "   " },
  ] }] };
  const s = sanitizeState(v1, "2026-10-10");
  const p = s.plans[0];
  assert.equal(s.version, 2);
  assert.equal(s.active, "p1");
  assert.equal(p.name, "Untitled plan");
  assert.equal(p.start, "2026-10-10");
  assert.equal(p.days, 365);
  assert.equal(p.articles.length, 2);
  assert.equal(p.articles[0].url, "");
  assert.equal(p.articles[0].minutes, 1);
  assert.equal(p.articles[0].due, "2026-10-10");
  assert.notEqual(p.articles[0].id, p.articles[1].id);
  assert.equal(p.articles[1].url, "https://example.com/x");
  assert.equal(p.articles[1].minutes, 12);
  assert.deepEqual(s.favorites, []);
  assert.equal(s.prefs.theme, "system");
});

test("favourites are de-duplicated by link", () => {
  const s = sanitizeState({ plans: [{ name: "P", articles: [] }], favorites: [
    { title: "A", url: "https://example.com/a" }, { title: "A again", url: "http://www.example.com/a/" }, { title: "B" },
  ] }, "2026-10-10");
  assert.equal(s.favorites.length, 2);
});

test("links go stale after a week", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  assert.equal(linkIsStale({ url: "" }, now), false);
  assert.equal(linkIsStale({ url: "https://x.com", link: null }, now), true);
  assert.equal(linkIsStale({ url: "https://x.com", link: { checkedAt: "2026-10-05T00:00:00Z" } }, now), false);
  assert.equal(linkIsStale({ url: "https://x.com", link: { checkedAt: "2026-10-01T00:00:00Z" } }, now), true);
});
