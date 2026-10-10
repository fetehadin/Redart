import { test } from "vitest";
import assert from "node:assert/strict";
import { newArticle, favoriteFromArticle, type LedgerState, type Plan } from "../src/core";
import { applyOp, activePlan } from "../src/ledger";

function fixture(): LedgerState {
  const start = "2026-10-01";
  const mk = (title: string, due: string) => newArticle({ title, url: `https://example.com/${title}`, due }, start);
  const p1: Plan = { id: "p1", name: "October", start, days: 30, articles: [mk("a", "2026-10-01"), mk("b", "2026-10-05"), mk("c", "2026-10-09")] };
  const p2: Plan = { id: "p2", name: "November", start: "2026-11-01", days: 30, articles: [] };
  return { version: 2, active: "p1", plans: [p1, p2], favorites: [], prefs: { theme: "system" } };
}

test("ops never mutate the input state", () => {
  const s = fixture();
  const before = JSON.stringify(s);
  const a = s.plans[0]!.articles[0]!;
  applyOp(s, { type: "article.update", planId: "p1", articleId: a.id, patch: { done: true, doneAt: "2026-10-02" } });
  applyOp(s, { type: "article.move", planId: "p1", articleId: s.plans[0]!.articles[0]!.id, to: 1 });
  applyOp(s, { type: "plan.update", planId: "p1", name: "X", start: "2026-10-03", days: 10 });
  applyOp(s, { type: "plan.delete", planId: "p1" });
  assert.equal(JSON.stringify(s), before);
});

test("unknown ids leave the state untouched (same object)", () => {
  const s = fixture();
  assert.equal(applyOp(s, { type: "article.remove", planId: "p1", articleId: "nope" }), s);
  assert.equal(applyOp(s, { type: "article.update", planId: "nope", articleId: "x", patch: { title: "y" } }), s);
  assert.equal(applyOp(s, { type: "plan.select", planId: "nope" }), s);
  assert.equal(applyOp(s, { type: "favorite.remove", favoriteId: "nope" }), s);
});

test("moving the plan start moves the due dates with it", () => {
  const s = applyOp(fixture(), { type: "plan.update", planId: "p1", name: "Oct", start: "2026-10-04", days: 30 });
  assert.deepEqual(activePlan(s).articles.map((a) => a.due), ["2026-10-04", "2026-10-08", "2026-10-12"]);
  assert.equal(activePlan(s).name, "Oct");
});

test("move keeps the date slots, and replaying it changes nothing", () => {
  const s0 = fixture();
  const a = s0.plans[0]!.articles[0]!;
  const s = applyOp(s0, { type: "article.move", planId: "p1", articleId: a.id, to: 1 });
  const A = activePlan(s).articles;
  assert.deepEqual(A.map((x) => x.title), ["b", "a", "c"]);
  assert.deepEqual(A.map((x) => x.due), ["2026-10-01", "2026-10-05", "2026-10-09"]);
  assert.equal(applyOp(s, { type: "article.move", planId: "p1", articleId: a.id, to: 1 }), s);
  // a longer move shifts everything in between through the slots
  const far = applyOp(s0, { type: "article.move", planId: "p1", articleId: s0.plans[0]!.articles[2]!.id, to: 0 });
  assert.deepEqual(activePlan(far).articles.map((x) => x.title), ["c", "a", "b"]);
  assert.deepEqual(activePlan(far).articles.map((x) => x.due), ["2026-10-01", "2026-10-05", "2026-10-09"]);
  assert.equal(applyOp(s0, { type: "article.move", planId: "p1", articleId: "nope", to: 0 }), s0);
});

test("deleting the active plan selects the latest one; the last plan can't be deleted", () => {
  let s = applyOp(fixture(), { type: "plan.delete", planId: "p1" });
  assert.equal(s.plans.length, 1);
  assert.equal(s.active, "p2");
  assert.equal(applyOp(s, { type: "plan.delete", planId: "p2" }), s);
  // undo = create at the old index
  s = applyOp(s, { type: "plan.create", plan: fixture().plans[0]!, index: 0 });
  assert.deepEqual(s.plans.map((p) => p.id), ["p1", "p2"]);
  assert.equal(s.active, "p1");
});

test("removing and re-adding an article at its index restores order", () => {
  const s0 = fixture();
  const b = s0.plans[0]!.articles[1]!;
  const s1 = applyOp(s0, { type: "article.remove", planId: "p1", articleId: b.id });
  const s2 = applyOp(s1, { type: "article.add", planId: "p1", article: b, index: 1 });
  assert.deepEqual(activePlan(s2).articles.map((a) => a.title), ["a", "b", "c"]);
  assert.equal(applyOp(s2, { type: "article.add", planId: "p1", article: b }), s2); // no duplicates
});

test("setDues only touches listed articles", () => {
  const s0 = fixture();
  const [a, b] = s0.plans[0]!.articles;
  const s = applyOp(s0, { type: "plan.setDues", planId: "p1", dues: { [a!.id]: "2026-10-20" } });
  assert.equal(activePlan(s).articles[0]!.due, "2026-10-20");
  assert.equal(activePlan(s).articles[1]!.due, b!.due);
});

test("favourites: add to the front, update, remove", () => {
  const f = favoriteFromArticle({ title: "t", url: "https://x.com/a", topic: "", minutes: 5 }, "2026-10-10");
  let s = applyOp(fixture(), { type: "favorite.add", favorite: f });
  s = applyOp(s, { type: "favorite.update", favoriteId: f.id, patch: { title: "T" } });
  assert.equal(s.favorites[0]!.title, "T");
  s = applyOp(s, { type: "favorite.remove", favoriteId: f.id });
  assert.equal(s.favorites.length, 0);
});

test("plans can be hidden from followers and shown again", () => {
  const s = applyOp(fixture(), { type: "plan.setShared", planId: "p1", shared: false });
  assert.equal(activePlan(s).shared, false);
  const back = applyOp(s, { type: "plan.setShared", planId: "p1", shared: true });
  assert.equal(activePlan(back).shared, true);
  const f = fixture();
  assert.equal(applyOp(f, { type: "plan.setShared", planId: "p1", shared: true }), f); // shared is the default: no change
});
