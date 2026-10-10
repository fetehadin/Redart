import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { client, fakeMailer, makeApp, signedUp, testConfig, useDb } from "./helpers";
import { hashToken } from "../src/services/sessions";

const db = useDb();
const body = (o: Partial<Record<string, string>> = {}) => ({ email: "ada@example.com", handle: "ada", displayName: "Ada", password: "correct horse battery", ...o });

describe("sign up", () => {
  test("creates the account, signs in with a safe cookie, and never returns the hash", async () => {
    const c = client(makeApp(db()));
    const res = await c.post("/api/auth/signup", body({ email: "  Ada@Example.COM ", handle: "Ada" })).expect(201);
    assert.equal(res.body.user.email, "ada@example.com");
    assert.equal(res.body.user.handle, "ada");
    assert.equal(res.body.user.passwordHash, undefined);
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /redart_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const me = await c.get("/api/me").expect(200);
    assert.equal(me.body.user.handle, "ada");
    const row = await db().user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    assert.match(row.passwordHash, /^\$argon2id\$/);
  });

  test("only the token's hash is stored", async () => {
    const res = await client(makeApp(db())).post("/api/auth/signup", body()).expect(201);
    const token = /redart_session=([^;]+)/.exec(String(res.headers["set-cookie"]))![1]!;
    const sessions = await db().session.findMany();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.tokenHash, hashToken(token));
    assert.notEqual(sessions[0]!.tokenHash, token);
  });

  test("duplicate email or handle is a 409 that names the field", async () => {
    const app = makeApp(db());
    await client(app).post("/api/auth/signup", body()).expect(201);
    const dupHandle = await client(app).post("/api/auth/signup", body({ email: "other@example.com" })).expect(409);
    assert.ok(dupHandle.body.error.fields.handle);
    const dupEmail = await client(app).post("/api/auth/signup", body({ handle: "other" })).expect(409);
    assert.ok(dupEmail.body.error.fields.email);
  });

  test("bad input is a 400 with field messages", async () => {
    const res = await client(makeApp(db())).post("/api/auth/signup", body({ handle: "no spaces!", password: "short" })).expect(400);
    assert.equal(res.body.error.code, "VALIDATION");
    assert.ok(res.body.error.fields.handle);
    assert.ok(res.body.error.fields.password);
  });

  test("emails listed in ADMIN_EMAILS become admins", async () => {
    const app = makeApp(db(), { config: testConfig({ adminEmails: ["ada@example.com"] }) });
    const res = await client(app).post("/api/auth/signup", body()).expect(201);
    assert.equal(res.body.user.isAdmin, true);
  });
});

describe("sign in and out", () => {
  test("wrong password and unknown email get the same answer", async () => {
    const app = makeApp(db());
    await signedUp(app, { email: "grace@example.com" });
    const wrong = await client(app).post("/api/auth/signin", { email: "grace@example.com", password: "nope nope nope" }).expect(401);
    const unknown = await client(app).post("/api/auth/signin", { email: "nobody@example.com", password: "nope nope nope" }).expect(401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  test("sign in works with any email casing, and sign out ends the session", async () => {
    const app = makeApp(db());
    const { password } = await signedUp(app, { email: "grace@example.com" });
    const c = client(app);
    await c.post("/api/auth/signin", { email: "GRACE@example.com", password }).expect(200);
    await c.get("/api/me").expect(200);
    await c.post("/api/auth/signout").expect(204);
    await c.get("/api/me").expect(401);
  });

  test("sign out everywhere ends every session", async () => {
    const app = makeApp(db());
    const { c: phone, password, user } = await signedUp(app);
    const laptop = client(app);
    await laptop.post("/api/auth/signin", { email: user.email, password }).expect(200);
    await phone.post("/api/auth/signout-all").expect(204);
    await laptop.get("/api/me").expect(401);
    await phone.get("/api/me").expect(401);
  });

  test("expired sessions don't work and are cleaned up", async () => {
    const app = makeApp(db());
    const { c } = await signedUp(app);
    await db().session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await c.get("/api/me").expect(401);
    assert.equal(await db().session.count(), 0);
  });

  test("sign-in attempts are rate limited", async () => {
    const c = client(makeApp(db()));
    for (let i = 0; i < 10; i++) await c.post("/api/auth/signin", { email: "x@example.com", password: "whatever" }).expect(401);
    await c.post("/api/auth/signin", { email: "x@example.com", password: "whatever" }).expect(429);
  });
});

describe("/me", () => {
  test("requires a session", async () => {
    const res = await client(makeApp(db())).get("/api/me").expect(401);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  });

  test("updates profile fields and refuses a taken handle", async () => {
    const app = makeApp(db());
    await signedUp(app, { handle: "taken" });
    const { c } = await signedUp(app);
    const res = await c.patch("/api/me", { displayName: "New Name", bio: "Reads about databases.", topics: ["Postgres", "Caching"], visibility: "PRIVATE" }).expect(200);
    assert.equal(res.body.user.displayName, "New Name");
    assert.deepEqual(res.body.user.topics, ["Postgres", "Caching"]);
    assert.equal(res.body.user.visibility, "PRIVATE");
    await c.patch("/api/me", { handle: "taken" }).expect(409);
  });

  test("changing the password needs the current one and signs out other devices only", async () => {
    const app = makeApp(db());
    const { c, password, user } = await signedUp(app);
    const other = client(app);
    await other.post("/api/auth/signin", { email: user.email, password }).expect(200);
    await c.patch("/api/me/password", { currentPassword: "wrong wrong wrong", newPassword: "a brand new passphrase" }).expect(400);
    await c.patch("/api/me/password", { currentPassword: password, newPassword: "a brand new passphrase" }).expect(200);
    await c.get("/api/me").expect(200);
    await other.get("/api/me").expect(401);
    await client(app).post("/api/auth/signin", { email: user.email, password: "a brand new passphrase" }).expect(200);
  });

  test("deleting the account needs the password and removes everything it owns", async () => {
    const app = makeApp(db());
    const { c, password } = await signedUp(app);
    await c.get("/api/ledger").expect(200); // creates the starter plan
    await c.del("/api/me", { password: "wrong wrong wrong" }).expect(400);
    await c.del("/api/me", { password }).expect(204);
    assert.equal(await db().user.count(), 0);
    assert.equal(await db().plan.count(), 0);
    assert.equal(await db().article.count(), 0);
    assert.equal(await db().session.count(), 0);
  });
});

describe("password reset", () => {
  test("is unavailable without SMTP", async () => {
    const c = client(makeApp(db()));
    assert.deepEqual((await c.get("/api/auth/options").expect(200)).body, { passwordReset: false });
    await c.post("/api/auth/reset/request", { email: "a@example.com" }).expect(404);
  });

  test("emails a one-time link that sets a new password and signs out everywhere", async () => {
    const mailer = fakeMailer();
    const app = makeApp(db(), { config: testConfig({ mailer }) });
    const { c, user } = await signedUp(app);
    const anon = client(app);
    assert.deepEqual((await anon.get("/api/auth/options")).body, { passwordReset: true });

    await anon.post("/api/auth/reset/request", { email: "nobody@example.com" }).expect(200);
    assert.equal(mailer.sent.length, 0); // same answer, no email
    await anon.post("/api/auth/reset/request", { email: user.email }).expect(200);
    assert.equal(mailer.sent.length, 1);
    const token = /token=([A-Za-z0-9_-]+)/.exec(mailer.sent[0]!.text)![1]!;

    await anon.post("/api/auth/reset/confirm", { token, password: "fresh passphrase here" }).expect(200);
    await c.get("/api/me").expect(401);
    await anon.post("/api/auth/reset/confirm", { token, password: "another passphrase" }).expect(400); // used once
    await client(app).post("/api/auth/signin", { email: user.email, password: "fresh passphrase here" }).expect(200);
  });
});
