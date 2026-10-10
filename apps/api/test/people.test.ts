import { describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { newArticle, uid, type LedgerOp, type Plan } from "@redart/shared";
import { makeApp, signedUp, useDb, type Client } from "./helpers";

const db = useDb();
const ops = (c: Client, ...list: LedgerOp[]) => c.post("/api/ledger/ops?today=2026-10-10", { ops: list }).expect(200);

/** A plan with one finished article carrying a private note. */
async function readingWithNote(c: Client, opts: { shared?: boolean; name?: string } = {}): Promise<Plan> {
  const a = newArticle({ title: "Read and noted", url: "https://example.com/read", minutes: 12, due: "2026-10-02" }, "2026-10-01");
  const p: Plan = { id: uid(), name: opts.name ?? "October", start: "2026-10-01", days: 30, articles: [a, newArticle({ title: "Not yet", minutes: 8 }, "2026-10-01")] };
  if (opts.shared === false) p.shared = false;
  await ops(c, { type: "plan.create", plan: p },
    { type: "article.update", planId: p.id, articleId: a.id, patch: { done: true, doneAt: "2026-10-03", notes: "MY PRIVATE NOTE" } });
  return p;
}

const everything = async (c: Client, handle: string) => [
  await c.get(`/api/users/${handle}`), await c.get(`/api/users/${handle}/plans`), await c.get(`/api/users/${handle}/finished`),
  await c.get(`/api/users/${handle}/favorites`), await c.get(`/api/users/${handle}/followers`),
];

describe("profiles", () => {
  test("a public reader's progress is visible to members, and notes never are", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    await readingWithNote(ada.c);
    const bob = await signedUp(app);

    const profile = (await bob.c.get("/api/users/ADA").expect(200)).body;
    assert.equal(profile.handle, "ada");
    assert.equal(profile.canSeeReading, true);
    assert.equal(profile.stats.articlesRead, 1);
    assert.equal(profile.stats.minutesRead, 12);
    assert.deepEqual(profile.relationship, { self: false, following: "none", followsYou: "none", blocked: false });

    const plans = (await bob.c.get("/api/users/ada/plans").expect(200)).body.items;
    assert.equal(plans.length, 1);
    assert.equal(plans[0].done, 1);
    assert.equal(plans[0].total, 2);
    const finished = (await bob.c.get("/api/users/ada/finished").expect(200)).body.items;
    assert.equal(finished[0].title, "Read and noted");

    for (const res of await everything(bob.c, "ada")) assert.doesNotMatch(JSON.stringify(res.body), /MY PRIVATE NOTE|passwordHash|email/);
  });

  test("guests see only the header", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    await readingWithNote(ada.c);
    const profile = (await request(app).get("/api/users/ada").expect(200)).body;
    assert.equal(profile.canSeeReading, false);
    assert.equal(profile.stats, null);
    assert.equal(profile.relationship, null);
    await request(app).get("/api/users/ada/plans").expect(403);
    await request(app).get("/api/users/ada/finished").expect(403);
  });

  test("unknown handles are 404", async () => {
    const { c } = await signedUp(makeApp(db()));
    await c.get("/api/users/nobody_here").expect(404);
  });

  test("hidden plans and their reading stay hidden from others but not from the owner", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    await readingWithNote(ada.c, { shared: false, name: "Secret" });
    const bob = await signedUp(app);
    const asBob = (await bob.c.get("/api/users/ada").expect(200)).body;
    assert.equal(asBob.stats.articlesRead, 0);
    assert.equal((await bob.c.get("/api/users/ada/plans")).body.items.length, 0);
    assert.equal((await bob.c.get("/api/users/ada/finished")).body.items.length, 0);
    const asAda = (await ada.c.get("/api/users/ada").expect(200)).body;
    assert.equal(asAda.stats.articlesRead, 1);
    assert.equal((await ada.c.get("/api/users/ada/plans")).body.items.length, 1);
  });

  test("finished articles page with a cursor", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    const articles = Array.from({ length: 5 }, (_, i) => ({ ...newArticle({ title: `A${i}` }, "2026-10-01"), done: true, doneAt: `2026-10-0${i + 1}` }));
    await ops(ada.c, { type: "plan.create", plan: { id: uid(), name: "P", start: "2026-10-01", days: 30, articles } });
    const p1 = (await ada.c.get("/api/users/ada/finished?limit=2").expect(200)).body;
    assert.deepEqual(p1.items.map((x: { title: string }) => x.title), ["A4", "A3"]);
    const p2 = (await ada.c.get(`/api/users/ada/finished?limit=2&cursor=${p1.nextCursor}`).expect(200)).body;
    assert.deepEqual(p2.items.map((x: { title: string }) => x.title), ["A2", "A1"]);
  });
});

describe("following", () => {
  test("following a public reader is immediate and notifies them; unfollowing undoes it", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    const bob = await signedUp(app, { handle: "bob" });
    assert.equal((await bob.c.post("/api/users/ada/follow").expect(201)).body.following, "accepted");
    assert.equal((await bob.c.post("/api/users/ada/follow").expect(200)).body.following, "accepted"); // idempotent
    assert.equal((await ada.c.get("/api/users/ada")).body.followers, 1);
    assert.equal((await ada.c.get("/api/users/bob")).body.relationship.followsYou, "accepted");
    assert.equal(await db().notification.count({ where: { kind: "NEW_FOLLOWER" } }), 1);
    const followers = (await ada.c.get("/api/users/ada/followers").expect(200)).body;
    assert.deepEqual(followers.items.map((u: { handle: string }) => u.handle), ["bob"]);
    await bob.c.del("/api/users/ada/follow").expect(200);
    assert.equal((await ada.c.get("/api/users/ada")).body.followers, 0);
  });

  test("a private account sees requests; only accepted followers see reading", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    await ada.c.patch("/api/me", { visibility: "PRIVATE" }).expect(200);
    await readingWithNote(ada.c);
    const bob = await signedUp(app, { handle: "bob" });
    const eve = await signedUp(app, { handle: "eve" });

    assert.equal((await bob.c.get("/api/users/ada")).body.canSeeReading, false);
    await bob.c.get("/api/users/ada/plans").expect(403);
    assert.equal((await bob.c.post("/api/users/ada/follow").expect(201)).body.following, "pending");
    await eve.c.post("/api/users/ada/follow").expect(201);
    assert.equal((await ada.c.get("/api/users/ada")).body.followers, 0);

    const requests = (await ada.c.get("/api/follow-requests").expect(200)).body.items;
    assert.deepEqual(requests.map((u: { handle: string }) => u.handle).sort(), ["bob", "eve"]);
    await ada.c.post("/api/follow-requests/bob/accept").expect(200);
    await ada.c.post("/api/follow-requests/eve/decline").expect(200);
    await ada.c.post("/api/follow-requests/eve/accept").expect(404); // already handled

    assert.equal((await bob.c.get("/api/users/ada")).body.canSeeReading, true);
    await bob.c.get("/api/users/ada/plans").expect(200);
    await eve.c.get("/api/users/ada/plans").expect(403);
    assert.equal(await db().notification.count({ where: { userId: bob.user.id, kind: "FOLLOW_ACCEPTED" } }), 1);
    assert.equal(await db().notification.count({ where: { kind: "FOLLOW_REQUEST" } }), 0);
  });

  test("going public accepts everyone waiting", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    await ada.c.patch("/api/me", { visibility: "PRIVATE" });
    const bob = await signedUp(app, { handle: "bob" });
    await bob.c.post("/api/users/ada/follow");
    await ada.c.patch("/api/me", { visibility: "PUBLIC" });
    assert.equal((await bob.c.get("/api/users/ada")).body.relationship.following, "accepted");
  });

  test("you can remove a follower, and can't follow yourself", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    const bob = await signedUp(app, { handle: "bob" });
    await bob.c.post("/api/users/ada/follow");
    await ada.c.del("/api/followers/bob").expect(200);
    assert.equal((await bob.c.get("/api/users/ada")).body.relationship.following, "none");
    await ada.c.post("/api/users/ada/follow").expect(400);
  });

  test("following needs an account", async () => {
    const app = makeApp(db());
    await signedUp(app, { handle: "ada" });
    await request(app).post("/api/users/ada/follow").set("origin", "http://localhost:3000").expect(401);
  });
});

describe("blocking", () => {
  test("removes follows both ways and hides each from the other", async () => {
    const app = makeApp(db());
    const ada = await signedUp(app, { handle: "ada" });
    const bob = await signedUp(app, { handle: "bob" });
    await bob.c.post("/api/users/ada/follow");
    await ada.c.post("/api/users/bob/follow");

    await ada.c.post("/api/users/bob/block").expect(200);
    assert.equal(await db().follow.count(), 0);
    assert.equal(await db().notification.count(), 0);

    // Bob can't find, see or follow Ada.
    await bob.c.get("/api/users/ada").expect(404);
    await bob.c.post("/api/users/ada/follow").expect(404);
    assert.equal((await bob.c.get("/api/users/search?q=ada")).body.items.length, 0);
    // Ada still sees Bob's header, marked blocked, but not his reading; she can't follow him either.
    const seen = (await ada.c.get("/api/users/bob").expect(200)).body;
    assert.equal(seen.relationship.blocked, true);
    assert.equal(seen.canSeeReading, false);
    await ada.c.post("/api/users/bob/follow").expect(403);
    assert.deepEqual((await ada.c.get("/api/blocks")).body.items.map((u: { handle: string }) => u.handle), ["bob"]);

    await ada.c.del("/api/users/bob/block").expect(200);
    await bob.c.get("/api/users/ada").expect(200);
  });
});

describe("search", () => {
  test("finds readers by handle prefix or name, with relationships", async () => {
    const app = makeApp(db());
    await signedUp(app, { handle: "grace_h", displayName: "Grace Hopper" });
    await signedUp(app, { handle: "linus", displayName: "Linus T" });
    const me = await signedUp(app);
    await me.c.post("/api/users/linus/follow");
    assert.deepEqual((await me.c.get("/api/users/search?q=@gra").expect(200)).body.items.map((u: { handle: string }) => u.handle), ["grace_h"]);
    const byName = (await me.c.get("/api/users/search?q=hopper").expect(200)).body.items;
    assert.equal(byName[0].handle, "grace_h");
    assert.equal((await me.c.get("/api/users/search?q=lin")).body.items[0].relationship.following, "accepted");
    await me.c.get("/api/users/search?q=").expect(400);
  });

  test("needs an account", async () => {
    await request(makeApp(db())).get("/api/users/search?q=a").expect(401);
  });
});
