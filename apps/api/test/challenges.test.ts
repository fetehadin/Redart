import { describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import type { ChallengeDetail, ChallengeSummary, LedgerState } from "@redart/shared";
import { makeApp, signedUp, testConfig, useDb, type Client } from "./helpers";

const db = useDb();
const TODAY = "2026-10-10";
const articles = Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/c${i}`, title: `Curated ${i}`, minutes: 10, topic: "Postgres" }));
const body = (o: Record<string, unknown> = {}) => ({
  title: "October: Postgres", description: "Read about Postgres.", start: "2026-10-01", days: 31, topics: ["Postgres"], articles, ...o,
});
const create = async (c: Client, o: Record<string, unknown> = {}) =>
  (await c.post(`/api/challenges?today=${TODAY}`, body(o)).expect(201)).body as { slug: string; inviteCode: string | null };
const detail = async (c: Client, slug: string, q = "") => (await c.get(`/api/challenges/${slug}${q}`).expect(200)).body as ChallengeDetail;
const ledger = async (c: Client) => (await c.get(`/api/ledger?today=${TODAY}`).expect(200)).body.state as LedgerState;

describe("creating", () => {
  test("makes three pace tracks sized to the challenge and a readable slug", async () => {
    const { c } = await signedUp(makeApp(db()));
    const { slug } = await create(c);
    assert.equal(slug, "october-postgres");
    const d = await detail(c, slug);
    assert.deepEqual(d.tracks.map((t) => [t.key, t.targetArticles]), [["light", 9], ["steady", 16], ["deep", 20]]); // deep capped at 20 articles
    assert.equal(d.articles.length, 20);
    assert.equal(d.canEdit, true);
    assert.equal((await create(c)).slug.startsWith("october-postgres-"), true); // taken slug gets a suffix
  });

  test("validates dates and contents; only admins can feature", async () => {
    const app = makeApp(db());
    const { c } = await signedUp(app);
    await c.post(`/api/challenges?today=${TODAY}`, body({ start: "2026-08-01", days: 30 })).expect(400); // already over
    await c.post(`/api/challenges?today=${TODAY}`, body({ days: 3 })).expect(400);
    await c.post(`/api/challenges?today=${TODAY}`, body({ articles: [] })).expect(400);
    await c.post(`/api/challenges?today=${TODAY}`, body({ featured: true })).expect(403);
    const admin = await signedUp(makeApp(db(), { config: testConfig({ adminEmails: ["boss@example.com"] }) }), { email: "boss@example.com" });
    const { slug } = await create(admin.c, { featured: true, title: "Featured one" });
    assert.equal((await detail(admin.c, slug)).featured, true);
  });

  test("only the creator (or an admin) can edit", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app);
    const bob = await signedUp(app);
    const { slug } = await create(ada.c);
    await bob.c.patch(`/api/challenges/${slug}`, { title: "Hijacked" }).expect(403);
    await ada.c.patch(`/api/challenges/${slug}`, { description: "Updated." }).expect(200);
    assert.equal((await detail(bob.c, slug)).description, "Updated.");
  });
});

describe("listing", () => {
  test("splits current, upcoming and past; featured and the reader's topics come first", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app);
    await create(ada.c, { title: "Plain current" , topics: ["Frontend"] });
    await create(ada.c, { title: "Postgres current", topics: ["Postgres"] });
    await create(ada.c, { title: "Next month", start: "2026-11-01", days: 30 });
    await db().challenge.create({ data: { slug: "old", title: "Old", start: new Date("2026-08-01T00:00:00Z"), days: 30, createdById: ada.user.id } });

    const bob = await signedUp(app);
    await bob.c.patch("/api/me", { topics: ["postgres"] });
    const current = (await bob.c.get(`/api/challenges?when=current&today=${TODAY}`).expect(200)).body.items as ChallengeSummary[];
    assert.deepEqual(current.map((c) => c.title), ["Postgres current", "Plain current"]);
    assert.equal(current[0]!.topicMatches, 1);
    const upcoming = (await bob.c.get(`/api/challenges?when=upcoming&today=${TODAY}`)).body.items as ChallengeSummary[];
    assert.deepEqual(upcoming.map((c) => c.title), ["Next month"]);
    const past = (await bob.c.get(`/api/challenges?when=past&today=${TODAY}`)).body.items as ChallengeSummary[];
    assert.deepEqual(past.map((c) => c.title), ["Old"]);
    // Guests can browse too.
    assert.equal((await request(app).get(`/api/challenges?today=${TODAY}`).expect(200)).body.items.length, 2);
  });

  test("invite-only challenges are hidden without the code", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app);
    const { slug, inviteCode } = await create(ada.c, { access: "INVITE", title: "Team reading" });
    assert.ok(inviteCode);
    const bob = await signedUp(app);
    assert.equal((await bob.c.get(`/api/challenges?today=${TODAY}`)).body.items.length, 0);
    await bob.c.get(`/api/challenges/${slug}`).expect(404);
    await bob.c.post(`/api/challenges/${slug}/join?today=${TODAY}`, { track: "light" }).expect(404);
    const d = await detail(bob.c, slug, `?invite=${inviteCode}`);
    assert.equal(d.inviteCode, null); // only the creator sees the code
    await bob.c.post(`/api/challenges/${slug}/join?today=${TODAY}`, { track: "light", inviteCode }).expect(201);
    await detail(bob.c, slug); // members can open it without the code from now on
    assert.equal((await detail(ada.c, slug)).inviteCode, inviteCode);
  });
});

describe("joining", () => {
  test("creates a ledger plan at the chosen pace, scheduled from today, and makes it active", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app);
    const { slug } = await create(ada.c);
    const bob = await signedUp(app);
    await bob.c.post(`/api/challenges/${slug}/join?today=${TODAY}`, { track: "steady" }).expect(201);
    await bob.c.post(`/api/challenges/${slug}/join?today=${TODAY}`, { track: "steady" }).expect(409);

    const s = await ledger(bob.c);
    const plan = s.plans.find((p) => p.id === s.active)!;
    assert.equal(plan.name, "October: Postgres");
    assert.equal(plan.articles.length, 16);
    assert.equal(plan.articles[0]!.due, TODAY);
    assert.equal(plan.articles.at(-1)!.due, "2026-10-31");
    assert.deepEqual(plan.challenge, { slug, title: "October: Postgres", track: "Steady" });

    const d = await detail(bob.c, slug);
    assert.equal(d.joined, "steady");
    assert.equal(d.participants, 1);
    assert.deepEqual(d.me && { track: d.me.track, done: d.me.done, total: d.me.total }, { track: "steady", done: 0, total: 16 });
  });

  test("joining shows in followers' feeds", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    const { slug } = await create(ada.c);
    const bob = await signedUp(app);
    await bob.c.post("/api/users/ada/follow");
    await ada.c.post(`/api/challenges/${slug}/join?today=${TODAY}`, { track: "deep" }).expect(201);
    const items = (await bob.c.get("/api/feed")).body.items;
    assert.equal(items[0].kind, "JOINED_CHALLENGE");
    assert.equal(items[0].challenge.slug, slug);
  });

  test("switching pace tops up from the curated list and re-spreads unread articles; leaving keeps the plan", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app);
    const { slug } = await create(ada.c);
    await ada.c.post(`/api/challenges/${slug}/join?today=2026-10-01`, { track: "light" }).expect(201);
    let s = await ledger(ada.c);
    let plan = s.plans.find((p) => p.id === s.active)!;
    assert.equal(plan.articles.length, 9);
    // finish one, so it must keep its date
    const first = plan.articles[0]!;
    await ada.c.post(`/api/ledger/ops?today=${TODAY}`, { ops: [{ type: "article.update", planId: plan.id, articleId: first.id, patch: { done: true, doneAt: "2026-10-01" } }] }).expect(200);

    const res = await ada.c.post(`/api/challenges/${slug}/track?today=${TODAY}`, { track: "deep" }).expect(200);
    assert.equal(res.body.added, 11);
    s = await ledger(ada.c);
    plan = s.plans.find((p) => p.id === plan.id)!;
    assert.equal(plan.articles.length, 20);
    assert.equal(plan.articles[0]!.due, first.due);
    assert.ok(plan.articles.filter((a) => !a.done).every((a) => a.due >= TODAY));
    assert.equal(plan.challenge?.track, "Deep");

    await ada.c.del(`/api/challenges/${slug}/join`).expect(200);
    s = await ledger(ada.c);
    plan = s.plans.find((p) => p.id === plan.id)!;
    assert.equal(plan.articles.length, 20);
    assert.equal(plan.challenge, undefined);
    assert.equal((await detail(ada.c, slug)).participants, 0);
  });

  test("a finished challenge can't be joined", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app);
    const { slug } = await create(ada.c);
    await ada.c.post(`/api/challenges/${slug}/join?today=2026-11-05`, { track: "light" }).expect(400);
  });
});

describe("leaderboard", () => {
  test("lists only readers who opted in, ranked by articles finished", async () => {
    const app = makeApp(db());
    const owner = await signedUp(app);
    const { slug } = await create(owner.c);
    const fast = await signedUp(app, { handle: "fast" });
    const slow = await signedUp(app, { handle: "slow" });
    const shy = await signedUp(app, { handle: "shy" });
    for (const [who, show] of [[fast, true], [slow, true], [shy, false]] as const)
      await who.c.post(`/api/challenges/${slug}/join?today=${TODAY}`, { track: "steady", showOnLeaderboard: show }).expect(201);

    const tickN = async (c: Client, n: number) => {
      const s = await ledger(c);
      const p = s.plans.find((x) => x.id === s.active)!;
      await c.post(`/api/ledger/ops?today=${TODAY}`, { ops: p.articles.slice(0, n).map((a) => ({ type: "article.update", planId: p.id, articleId: a.id, patch: { done: true, doneAt: TODAY } })) }).expect(200);
    };
    await tickN(fast.c, 3);
    await tickN(slow.c, 1);
    await tickN(shy.c, 5);

    const rows = (await request(app).get(`/api/challenges/${slug}/leaderboard`).expect(200)).body.items;
    assert.deepEqual(rows.map((r: { user: { handle: string }; done: number; rank: number }) => [r.rank, r.user.handle, r.done]), [[1, "fast", 3], [2, "slow", 1]]);

    await shy.c.patch(`/api/challenges/${slug}/me`, { showOnLeaderboard: true }).expect(200);
    const again = (await request(app).get(`/api/challenges/${slug}/leaderboard`)).body.items;
    assert.equal(again[0].user.handle, "shy");
  });
});

describe("profiles list joined challenges", () => {
  test("public challenges show on the profile", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    const { slug } = await create(ada.c);
    await ada.c.post(`/api/challenges/${slug}/join?today=${TODAY}`, { track: "light" });
    const bob = await signedUp(app);
    const items = (await bob.c.get("/api/users/ada/challenges").expect(200)).body.items;
    assert.deepEqual(items.map((i: { slug: string; track: string }) => [i.slug, i.track]), [[slug, "Light"]]);
  });
});
