import { describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, useDb, ORIGIN } from "./helpers";
import { DbLinkCache } from "../src/services/linkCache";

const db = useDb();
const article = `<!doctype html><html><head><title>Hi</title></head><body><article>${"word ".repeat(2380)}</article></body></html>`;

function fakeNet() {
  let fetches = 0;
  return {
    deps: {
      lookup: async () => ["93.184.216.34"],
      fetch: async () => { fetches++; return new Response(article, { headers: { "content-type": "text/html" } }); },
    },
    fetches: () => fetches,
  };
}

describe("GET /api/health", () => {
  test("responds ok when the database answers", async () => {
    const res = await request(makeApp(db())).get("/api/health").expect(200);
    assert.deepEqual(res.body, { ok: true });
  });
});

describe("GET /api/inspect", () => {
  test("returns the analysis for a working article", async () => {
    const net = fakeNet();
    const res = await request(makeApp(db(), { inspect: net.deps })).get("/api/inspect").query({ url: "https://blog.example.com/post" }).expect(200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.minutes, 10);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("reports bad input in the body, not as an HTTP error", async () => {
    const res = await request(makeApp(db())).get("/api/inspect").query({ url: "http://127.0.0.1/" }).expect(200);
    assert.equal(res.body.status, "blocked");
    const none = await request(makeApp(db())).get("/api/inspect").expect(200);
    assert.equal(none.body.status, "invalid");
  });

  test("the same article written differently is fetched once, using the shared Link table", async () => {
    const net = fakeNet();
    const app = makeApp(db(), { inspect: net.deps, linkCache: new DbLinkCache(db()) });
    await request(app).get("/api/inspect").query({ url: "https://www.example.com/a/?utm_source=x" });
    const res = await request(app).get("/api/inspect").query({ url: "http://example.com/a" });
    assert.equal(net.fetches(), 1);
    assert.equal(res.body.url, "http://example.com/a");
    assert.equal(res.body.minutes, 10);
    assert.equal(await db().link.count(), 1);
  });

  test("rate limits after 40 checks a minute", async () => {
    const app = makeApp(db());
    for (let i = 0; i < 40; i++) await request(app).get("/api/inspect").query({ url: "ftp://x.com" }).expect(200);
    const res = await request(app).get("/api/inspect").query({ url: "ftp://x.com" }).expect(429);
    assert.equal(res.body.error.code, "RATE_LIMITED");
  });
});

describe("cross-cutting", () => {
  test("404 is JSON", async () => {
    const res = await request(makeApp(db())).get("/api/nope").expect(404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  test("helmet headers are set", async () => {
    const res = await request(makeApp(db())).get("/api/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  test("writes from another site, or without an Origin, are refused (CSRF)", async () => {
    const app = makeApp(db());
    const body = { email: "a@example.com", password: "x" };
    const foreign = await request(app).post("/api/auth/signin").set("origin", "https://evil.example").send(body).expect(403);
    assert.equal(foreign.body.error.code, "FORBIDDEN");
    await request(app).post("/api/auth/signin").send(body).expect(403);
    await request(app).post("/api/auth/signin").set("origin", ORIGIN).send(body).expect(401);
  });

  test("malformed JSON is a 400, not a crash", async () => {
    const res = await request(makeApp(db())).post("/api/auth/signin").set("origin", ORIGIN).set("content-type", "application/json").send("{oops").expect(400);
    assert.equal(res.body.error.code, "VALIDATION");
  });
});
