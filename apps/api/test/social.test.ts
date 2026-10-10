import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { newArticle, uid, type FeedItem, type LedgerOp, type Plan } from "@redart/shared";
import { makeApp, signedUp, useDb, type Client } from "./helpers";

const db = useDb();
const TODAY = "2026-10-10";
const ops = (c: Client, ...list: LedgerOp[]) => c.post(`/api/ledger/ops?today=${TODAY}`, { ops: list }).expect(200);
const feed = async (c: Client, q = ""): Promise<{ items: FeedItem[]; nextCursor: string | null; following: number }> =>
  (await c.get(`/api/feed${q}`).expect(200)).body;

async function planWith(c: Client, titles: string[], shared = true): Promise<Plan> {
  const p: Plan = { id: uid(), name: shared ? "October" : "Secret", start: "2026-10-01", days: 30,
    articles: titles.map((t) => newArticle({ title: t, url: `https://example.com/${t}`, minutes: 9 }, "2026-10-01")) };
  if (!shared) p.shared = false;
  await ops(c, { type: "plan.create", plan: p });
  return p;
}
const tick = (p: Plan, i: number, done = true): LedgerOp =>
  ({ type: "article.update", planId: p.id, articleId: p.articles[i]!.id, patch: { done, doneAt: done ? TODAY : null, notes: "NOTE-SECRET" } });

async function pair() {
  const app = makeApp(db());
  const ada = await signedUp(app, { handle: "ada" });
  const bob = await signedUp(app, { handle: "bob" });
  await bob.c.post("/api/users/ada/follow").expect(201);
  return { app, ada, bob };
}

describe("feed", () => {
  test("shows what followed readers finished, favourited and started, newest first, without notes", async () => {
    const { ada, bob } = await pair();
    const p = await planWith(ada.c, ["one", "two"]);
    await ops(ada.c, tick(p, 0));
    await ops(ada.c, { type: "favorite.add", favorite: { id: uid(), title: "Fav", url: "https://example.com/fav", topic: "", minutes: 4, savedAt: TODAY } });

    const f = await feed(bob.c);
    assert.deepEqual(f.items.map((i) => i.kind), ["FAVORITED", "FINISHED", "STARTED_PLAN"]);
    const finished = f.items[1] as Extract<FeedItem, { kind: "FINISHED" }>;
    assert.equal(finished.actor.handle, "ada");
    assert.equal(finished.article.title, "one");
    assert.equal(finished.planName, "October");
    assert.doesNotMatch(JSON.stringify(f), /NOTE-SECRET|email|passwordHash/);
  });

  test("unticking or removing an article takes it out of the feed; reticking doesn't duplicate", async () => {
    const { ada, bob } = await pair();
    const p = await planWith(ada.c, ["one", "two"]);
    await ops(ada.c, tick(p, 0), tick(p, 0, false), tick(p, 0), tick(p, 1));
    let kinds = (await feed(bob.c)).items.filter((i) => i.kind === "FINISHED");
    assert.equal(kinds.length, 2);
    await ops(ada.c, tick(p, 1, false), { type: "article.remove", planId: p.id, articleId: p.articles[0]!.id });
    kinds = (await feed(bob.c)).items.filter((i) => i.kind === "FINISHED");
    assert.equal(kinds.length, 0);
  });

  test("hidden plans, unfollowed and blocked readers, and pending requests never show", async () => {
    const { app, ada, bob } = await pair();
    const secret = await planWith(ada.c, ["hidden"], false);
    await ops(ada.c, tick(secret, 0));
    assert.equal((await feed(bob.c)).items.length, 0);

    const eve = await signedUp(app, { handle: "eve" });
    await eve.c.patch("/api/me", { visibility: "PRIVATE" });
    const e = await planWith(eve.c, ["x"]);
    await ops(eve.c, tick(e, 0));
    await bob.c.post("/api/users/eve/follow").expect(201); // pending
    assert.ok((await feed(bob.c)).items.every((i) => i.actor.handle !== "eve"));

    const shown = await planWith(ada.c, ["visible"]);
    await ops(ada.c, tick(shown, 0));
    assert.ok((await feed(bob.c)).items.length > 0);
    await ada.c.post("/api/users/bob/block");
    assert.equal((await feed(bob.c)).items.length, 0);
  });

  test("pages with a cursor and reports how many readers you follow", async () => {
    const { ada, bob } = await pair();
    const p = await planWith(ada.c, ["a", "b", "c", "d"]);
    for (let i = 0; i < 4; i++) await ops(ada.c, tick(p, i));
    const first = await feed(bob.c, "?limit=2");
    assert.equal(first.following, 1);
    assert.equal(first.items.length, 2);
    const second = await feed(bob.c, `?limit=2&cursor=${first.nextCursor}`);
    assert.equal(second.items.length, 2);
    assert.notEqual(second.items[0]!.id, first.items[1]!.id);
  });

  test("needs an account", async () => {
    const { c } = await signedUp(makeApp(db()));
    await c.post("/api/auth/signout");
    await c.get("/api/feed").expect(401);
  });
});

describe("recommendations", () => {
  const rec = { url: "example.com/great", title: "A great read", minutes: 7, message: "You'll like this one." };

  test("to all followers: shows in their feed", async () => {
    const { ada, bob } = await pair();
    const res = await ada.c.post("/api/recommendations", rec).expect(201);
    assert.equal(res.body.to, null);
    const item = (await feed(bob.c)).items[0] as Extract<FeedItem, { kind: "RECOMMENDED" }>;
    assert.equal(item.kind, "RECOMMENDED");
    assert.equal(item.article.url, "https://example.com/great");
    assert.equal(item.message, "You'll like this one.");
  });

  test("directly to a follower: lands in their inbox with a notification", async () => {
    const { ada, bob } = await pair();
    await ada.c.post("/api/recommendations", { ...rec, toHandle: "bob" }).expect(201);
    const inbox = (await bob.c.get("/api/inbox/recommendations").expect(200)).body.items;
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].from.handle, "ada");
    assert.equal((await bob.c.get("/api/notifications/unread-count")).body.count, 1);
    const n = (await bob.c.get("/api/notifications")).body.items[0];
    assert.equal(n.kind, "RECOMMENDATION");
    assert.equal(n.recommendation.article.title, "A great read");
    await bob.c.post("/api/notifications/read").expect(200);
    assert.equal((await bob.c.get("/api/notifications/unread-count")).body.count, 0);
    assert.equal((await bob.c.get("/api/inbox/recommendations")).body.items[0].read, true);
  });

  test("can't be sent directly to someone who doesn't follow you", async () => {
    const { app, bob } = await pair();
    await signedUp(app, { handle: "stranger" });
    // Bob follows Ada, but Ada doesn't follow Bob: Bob can't push into Ada's inbox.
    await bob.c.post("/api/recommendations", { ...rec, toHandle: "ada" }).expect(403);
    await bob.c.post("/api/recommendations", { ...rec, toHandle: "stranger" }).expect(403);
    await bob.c.post("/api/recommendations", { ...rec, toHandle: "nobody_at_all" }).expect(404);
  });

  test("validates the link and message length", async () => {
    const { ada } = await pair();
    await ada.c.post("/api/recommendations", { ...rec, url: "javascript:alert(1)" }).expect(400);
    await ada.c.post("/api/recommendations", { ...rec, message: "x".repeat(281) }).expect(400);
  });
});

describe("notifications", () => {
  test("follows and accepted requests notify; never yourself", async () => {
    const { app, ada } = await pair();
    const n = (await ada.c.get("/api/notifications")).body.items;
    assert.deepEqual(n.map((x: { kind: string }) => x.kind), ["NEW_FOLLOWER"]);
    assert.equal(n[0].actor.handle, "bob");
    const eve = await signedUp(app, { handle: "eve" });
    await eve.c.patch("/api/me", { visibility: "PRIVATE" });
    await ada.c.post("/api/users/eve/follow");
    await eve.c.post("/api/follow-requests/ada/accept");
    const mine = (await ada.c.get("/api/notifications")).body.items.map((x: { kind: string }) => x.kind);
    assert.ok(mine.includes("FOLLOW_ACCEPTED"));
  });
});

describe("quick add", () => {
  test("adds to the active plan after its last article, once", async () => {
    const { bob } = await pair();
    const before = (await bob.c.get(`/api/ledger?today=${TODAY}`)).body.state;
    const body = { url: "https://example.com/new", title: "New one", minutes: 6 };
    const first = await bob.c.post(`/api/ledger/quick-add?today=${TODAY}`, body).expect(201);
    assert.equal(first.body.planName, before.plans[0].name);
    assert.equal(first.body.duplicate, false);
    const again = await bob.c.post(`/api/ledger/quick-add?today=${TODAY}`, { ...body, url: "http://www.example.com/new/" }).expect(200);
    assert.equal(again.body.duplicate, true);
    const after = (await bob.c.get(`/api/ledger?today=${TODAY}`)).body.state;
    assert.equal(after.plans[0].articles.length, before.plans[0].articles.length + 1);
    assert.equal(after.plans[0].articles.at(-1).title, "New one");
  });
});
