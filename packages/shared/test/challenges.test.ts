import { test } from "vitest";
import assert from "node:assert/strict";
import { articlesForTrack, challengeWhen, nextMonth, retrack, slugify, TRACKS, trackTarget, type CuratedArticle } from "../src/challenges";

const curated: CuratedArticle[] = Array.from({ length: 40 }, (_, i) => ({ url: `https://example.com/${i}`, title: `T${i}`, minutes: i % 2 ? 10 : null, topic: "x" }));
const oct = { start: "2026-10-01", days: 31 };
const rate = (k: string) => TRACKS.find((t) => t.key === k)!.rate;

test("track targets scale with the challenge length", () => {
  assert.equal(trackTarget(rate("light"), 31), 9);
  assert.equal(trackTarget(rate("steady"), 31), 16);
  assert.equal(trackTarget(rate("deep"), 31), 31);
  assert.equal(trackTarget(rate("light"), 1), 1);
});

test("joining before the start spreads the picked articles over the whole challenge", () => {
  const a = articlesForTrack(oct, curated, 9, "2026-09-20");
  assert.equal(a.length, 9);
  assert.equal(a[0]!.due, "2026-10-01");
  assert.equal(a[8]!.due, "2026-10-31");
  assert.equal(a[0]!.minutesAuto, true); // unknown minutes get estimated later
  assert.equal(a[1]!.minutes, 10);
});

test("joining late schedules from today, never in the past", () => {
  const a = articlesForTrack(oct, curated, 9, "2026-10-20");
  assert.equal(a[0]!.due, "2026-10-20");
  assert.equal(a.at(-1)!.due, "2026-10-31");
  assert.ok(a.every((x) => x.due >= "2026-10-20"));
});

test("switching to a faster pace adds curated articles and re-spreads only unread ones", () => {
  const start = articlesForTrack(oct, curated, 9, "2026-10-01");
  start[0]!.done = true;
  const own = { ...start[1]!, id: "mine", url: "https://mine.example/own", title: "Own" };
  const plan = { articles: [...start, own] };
  const r = retrack(oct, plan, curated, 16, "2026-10-10");
  assert.equal(r.added.length, 7);
  assert.equal(r.dues[start[0]!.id], undefined); // finished articles keep their date
  assert.ok("mine" in r.dues);
  assert.ok(Object.values(r.dues).every((d) => d >= "2026-10-10" && d <= "2026-10-31"));
  // slowing down adds nothing and removes nothing
  assert.equal(retrack(oct, plan, curated, 9, "2026-10-10").added.length, 0);
});

test("when, next month, slugs", () => {
  assert.equal(challengeWhen(oct, "2026-09-30"), "upcoming");
  assert.equal(challengeWhen(oct, "2026-10-31"), "current");
  assert.equal(challengeWhen(oct, "2026-11-01"), "past");
  assert.deepEqual(nextMonth("2026-10-10"), { start: "2026-11-01", days: 30 });
  assert.deepEqual(nextMonth("2026-12-31"), { start: "2027-01-01", days: 31 });
  assert.deepEqual(nextMonth("2028-01-15"), { start: "2028-02-01", days: 29 });
  assert.equal(slugify("October: Distributed Systems!"), "october-distributed-systems");
  assert.equal(slugify("ሰላም"), "challenge");
});
