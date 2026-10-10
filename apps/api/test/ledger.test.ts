import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { newArticle, uid, type LedgerOp, type LedgerState, type Plan } from "@redart/shared";
import { makeApp, signedUp, useDb, type Client } from "./helpers";

const db = useDb();
const TODAY = "2026-10-10";

async function ledger(c: Client): Promise<LedgerState> {
  return (await c.get(`/api/ledger?today=${TODAY}`).expect(200)).body.state;
}
const ops = (c: Client, ...list: LedgerOp[]) => c.post(`/api/ledger/ops?today=${TODAY}`, { ops: list });

function plan(name = "October", start = "2026-10-01", titles = ["a", "b", "c"]): Plan {
  return {
    id: uid(), name, start, days: 30,
    articles: titles.map((t, i) => newArticle({ title: t, url: `https://example.com/${t}`, minutes: 5, due: `2026-10-0${i + 1}` }, start)),
  };
}

describe("reading the ledger", () => {
  test("requires a session", async () => {
    const { c } = await signedUp(makeApp(db()));
    await c.post("/api/auth/signout");
    await c.get("/api/ledger").expect(401);
  });

  test("a new member starts with the starter plan, created once", async () => {
    const { c } = await signedUp(makeApp(db()));
    const [s1, s2] = await Promise.all([ledger(c), ledger(c)]);
    assert.equal(s1.plans.length, 1);
    assert.equal(s1.plans[0]!.articles.length, 15);
    assert.equal(s1.plans[0]!.start, TODAY);
    assert.equal(s2.plans.length, 1);
    assert.equal(await db().plan.count(), 1);
  });
});

describe("applying ops", () => {
  test("plans and articles round-trip exactly", async () => {
    const { c } = await signedUp(makeApp(db()));
    const p = plan();
    p.articles[0]!.link = { status: "ok", httpStatus: 200, message: "Link works.", checkedAt: "2026-10-01T10:00:00.000Z" };
    await ops(c, { type: "plan.create", plan: p }).expect(200);
    const s = await ledger(c);
    assert.equal(s.active, p.id);
    assert.deepEqual(s.plans.find((x) => x.id === p.id), p);
  });

  test("insert at an index, update, move and remove keep the order right", async () => {
    const { c } = await signedUp(makeApp(db()));
    const p = plan();
    const x = newArticle({ title: "x", url: "https://example.com/x", due: "2026-10-02" }, p.start);
    const [a, b] = p.articles;
    await ops(c,
      { type: "plan.create", plan: p },
      { type: "article.add", planId: p.id, article: x, index: 1 },
      { type: "article.update", planId: p.id, articleId: a!.id, patch: { done: true, doneAt: "2026-10-02", notes: "Good one", url: "https://www.example.com/A/" } },
      { type: "article.move", planId: p.id, articleId: p.articles[2]!.id, to: 2 },
      { type: "article.move", planId: p.id, articleId: p.articles[2]!.id, to: 2 }, // replay: no change
      { type: "article.remove", planId: p.id, articleId: x.id },
    ).expect(200);
    const got = (await ledger(c)).plans.find((q) => q.id === p.id)!;
    assert.deepEqual(got.articles.map((t) => t.title), ["a", "c", "b"]);
    assert.equal(got.articles[0]!.notes, "Good one");
    assert.equal(got.articles[0]!.doneAt, "2026-10-02");
    // moving keeps date slots: c took b's old slot
    assert.equal(got.articles[1]!.due, b!.due);
    const row = await db().article.findUniqueOrThrow({ where: { id: a!.id } });
    assert.equal(row.urlKey, "example.com/A");
  });

  test("moving a plan's start moves its due dates; setDues sets chosen ones", async () => {
    const { c } = await signedUp(makeApp(db()));
    const p = plan();
    await ops(c, { type: "plan.create", plan: p }, { type: "plan.update", planId: p.id, name: "Oct", start: "2026-10-04", days: 20 }).expect(200);
    let got = (await ledger(c)).plans.find((q) => q.id === p.id)!;
    assert.equal(got.name, "Oct");
    assert.deepEqual(got.articles.map((a) => a.due), ["2026-10-04", "2026-10-05", "2026-10-06"]);
    await ops(c, { type: "plan.setDues", planId: p.id, dues: { [p.articles[2]!.id]: "2026-10-20" } }).expect(200);
    got = (await ledger(c)).plans.find((q) => q.id === p.id)!;
    assert.deepEqual(got.articles.map((a) => a.due), ["2026-10-04", "2026-10-05", "2026-10-20"]);
  });

  test("deleting the active plan selects the latest; the last plan is kept", async () => {
    const { c } = await signedUp(makeApp(db()));
    const starter = (await ledger(c)).plans[0]!;
    const p = plan("Later", "2026-12-01");
    await ops(c, { type: "plan.create", plan: p }, { type: "plan.delete", planId: p.id }).expect(200);
    let s = await ledger(c);
    assert.deepEqual(s.plans.map((q) => q.id), [starter.id]);
    assert.equal(s.active, starter.id);
    await ops(c, { type: "plan.delete", planId: starter.id }).expect(200);
    s = await ledger(c);
    assert.equal(s.plans.length, 1);
  });

  test("favourites: add, update, remove, and no duplicates by link", async () => {
    const { c } = await signedUp(makeApp(db()));
    const f = { id: uid(), title: "Fav", url: "https://example.com/f", topic: "", minutes: 7, savedAt: TODAY };
    const same = { ...f, id: uid(), url: "http://www.example.com/f/" };
    await ops(c, { type: "favorite.add", favorite: f }, { type: "favorite.add", favorite: same }, { type: "favorite.update", favoriteId: f.id, patch: { title: "Fav!" } }).expect(200);
    let s = await ledger(c);
    assert.deepEqual(s.favorites.map((x) => x.title), ["Fav!"]);
    await ops(c, { type: "favorite.remove", favoriteId: f.id }).expect(200);
    s = await ledger(c);
    assert.equal(s.favorites.length, 0);
  });

  test("replayed ops (a retry after a dropped response) are harmless", async () => {
    const { c } = await signedUp(makeApp(db()));
    const p = plan();
    const x = newArticle({ title: "x" }, p.start);
    for (let i = 0; i < 2; i++) await ops(c, { type: "plan.create", plan: p }, { type: "article.add", planId: p.id, article: x }).expect(200);
    const got = (await ledger(c)).plans.find((q) => q.id === p.id)!;
    assert.equal(got.articles.length, 4);
  });

  test("a batch is all or nothing", async () => {
    const { c } = await signedUp(makeApp(db()));
    const p = plan();
    await ops(c, { type: "plan.create", plan: p }, { type: "article.update", planId: p.id, articleId: uid(), patch: { title: "ghost" } }).expect(404);
    assert.equal(await db().plan.count({ where: { id: p.id } }), 0);
  });

  test("invalid ops are rejected before touching anything", async () => {
    const { c } = await signedUp(makeApp(db()));
    const p = plan();
    p.articles[0]!.url = "javascript:alert(1)";
    const res = await ops(c, { type: "plan.create", plan: p }).expect(400);
    assert.equal(res.body.error.code, "VALIDATION");
    await c.post("/api/ledger/ops", { ops: [] }).expect(400);
  });

  test("restoring a backup replaces the ledger with fresh ids", async () => {
    const { c } = await signedUp(makeApp(db()));
    await ledger(c);
    const backup = { version: 1, active: "p1", plans: [{ id: "p1", name: "From backup", start: "2026-09-01", days: 30, articles: [{ id: "a1", title: "Old one", url: "example.com/old" }] }], favorites: [{ title: "F" }] };
    const res = await ops(c, { type: "state.replace", state: backup as unknown as LedgerState }).expect(200);
    assert.equal(res.body.reload, true);
    const s = await ledger(c);
    assert.deepEqual(s.plans.map((p) => p.name), ["From backup"]);
    assert.notEqual(s.plans[0]!.id, "p1");
    assert.equal(s.active, s.plans[0]!.id);
    assert.equal(s.plans[0]!.articles[0]!.url, "https://example.com/old");
    assert.equal(s.favorites.length, 1);
  });
});

describe("other members' ledgers are off limits", () => {
  test("can't read, change, select or delete someone else's plan", async () => {
    const app = makeApp(db());
    const alice = await signedUp(app);
    const bob = await signedUp(app);
    const p = plan();
    await ops(alice.c, { type: "plan.create", plan: p }).expect(200);
    const a = p.articles[0]!;

    await ops(bob.c, { type: "article.update", planId: p.id, articleId: a.id, patch: { title: "pwned", notes: "x" } }).expect(404);
    await ops(bob.c, { type: "plan.update", planId: p.id, name: "pwned", start: p.start, days: 3 }).expect(404);
    await ops(bob.c, { type: "plan.select", planId: p.id }).expect(404);
    await ops(bob.c, { type: "article.add", planId: p.id, article: newArticle({ title: "spam" }, p.start) }).expect(404);
    await ops(bob.c, { type: "plan.delete", planId: p.id }).expect(200); // silently ignored, like a stale undo
    await ops(bob.c, { type: "favorite.remove", favoriteId: uid() }).expect(200);

    const s = await ledger(alice.c);
    const got = s.plans.find((q) => q.id === p.id)!;
    assert.deepEqual(got, p);
    assert.ok(!(await ledger(bob.c)).plans.some((q) => q.id === p.id));
  });

  test("reusing another member's ids is a conflict, not a takeover", async () => {
    const app = makeApp(db());
    const alice = await signedUp(app);
    const bob = await signedUp(app);
    const p = plan();
    await ops(alice.c, { type: "plan.create", plan: p }).expect(200);
    const bobPlan = (await ledger(bob.c)).plans[0]!;
    await ops(bob.c, { type: "article.add", planId: bobPlan.id, article: p.articles[0]! }).expect(200); // replay guard: id exists, no-op
    const article = await db().article.findUniqueOrThrow({ where: { id: p.articles[0]!.id } });
    assert.equal(article.planId, p.id);
    const f = { id: uid(), title: "F", url: "https://example.com/f", topic: "", minutes: 3, savedAt: TODAY };
    await ops(alice.c, { type: "favorite.add", favorite: f }).expect(200);
    await ops(bob.c, { type: "favorite.add", favorite: f }).expect(409);
  });
});

describe("importing a guest ledger", () => {
  const guest = () => ({
    version: 2, active: "g1",
    plans: [
      { id: "g1", name: "October", start: "2026-10-01", days: 30, articles: [
        { id: "x", title: "Shared", url: "https://example.com/shared", minutes: 5, due: "2026-10-01", notes: "my note" },
        { id: "y", title: "Guest only", url: "https://example.com/guest", minutes: 5, due: "2026-10-02" },
      ] },
      { id: "g2", name: "Side reading", start: "2026-11-01", days: 10, articles: [{ id: "z", title: "Z" }] },
    ],
    favorites: [{ title: "Guest fav", url: "https://example.com/gf" }],
  });

  test("merges matching plans, creates the rest, and is idempotent", async () => {
    const { c } = await signedUp(makeApp(db()));
    const existing = plan("October", "2026-10-01", ["shared"]);
    await ops(c, { type: "plan.create", plan: existing }).expect(200);

    const first = await c.post(`/api/me/import?today=${TODAY}`, { state: guest() }).expect(200);
    assert.deepEqual(first.body, { plansCreated: 1, plansMerged: 1, articlesAdded: 2, favoritesAdded: 1 });
    const again = await c.post(`/api/me/import?today=${TODAY}`, { state: guest() }).expect(200);
    assert.equal(again.body.articlesAdded, 0);
    assert.equal(again.body.favoritesAdded, 0);

    const s = await ledger(c);
    const oct = s.plans.find((p) => p.id === existing.id)!;
    assert.deepEqual(oct.articles.map((a) => a.title), ["shared", "Guest only"]);
    assert.equal(s.active, existing.id); // importing doesn't switch plans
    assert.ok(s.plans.some((p) => p.name === "Side reading"));
  });

  test("rejects something that isn't a ledger", async () => {
    const { c } = await signedUp(makeApp(db()));
    await c.post("/api/me/import", { state: { hello: "world" } }).expect(400);
  });
});
