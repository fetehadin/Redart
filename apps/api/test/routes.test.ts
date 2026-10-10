import { describe, test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app";

const article = `<!doctype html><html><head><title>Hi</title></head><body><article>${"word ".repeat(2380)}</article></body></html>`;

function appWithFakeNet() {
  let fetches = 0;
  const app = createApp({
    inspect: {
      lookup: async () => ["93.184.216.34"],
      fetch: async () => { fetches++; return new Response(article, { headers: { "content-type": "text/html" } }); },
    },
  });
  return { app, fetches: () => fetches };
}

describe("GET /api/health", () => {
  test("responds ok", async () => {
    const res = await request(createApp()).get("/api/health").expect(200);
    assert.deepEqual(res.body, { ok: true });
  });
});

describe("GET /api/inspect", () => {
  test("returns the analysis for a working article", async () => {
    const { app } = appWithFakeNet();
    const res = await request(app).get("/api/inspect").query({ url: "https://blog.example.com/post" }).expect(200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.minutes, 10);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("reports bad input in the body, not as an HTTP error", async () => {
    const res = await request(createApp()).get("/api/inspect").query({ url: "http://127.0.0.1/" }).expect(200);
    assert.equal(res.body.status, "blocked");
    const none = await request(createApp()).get("/api/inspect").expect(200);
    assert.equal(none.body.status, "invalid");
  });

  test("the same article written differently is fetched once", async () => {
    const { app, fetches } = appWithFakeNet();
    await request(app).get("/api/inspect").query({ url: "https://www.example.com/a/?utm_source=x" });
    const res = await request(app).get("/api/inspect").query({ url: "http://example.com/a" });
    assert.equal(fetches(), 1);
    assert.equal(res.body.url, "http://example.com/a");
  });

  test("rate limits after 40 checks a minute", async () => {
    const app = createApp();
    for (let i = 0; i < 40; i++) await request(app).get("/api/inspect").query({ url: "ftp://x.com" }).expect(200);
    const res = await request(app).get("/api/inspect").query({ url: "ftp://x.com" }).expect(429);
    assert.equal(res.body.error.code, "RATE_LIMITED");
  });
});

describe("unknown routes and bad bodies", () => {
  test("404 is JSON", async () => {
    const res = await request(createApp()).get("/api/nope").expect(404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  test("helmet headers are set", async () => {
    const res = await request(createApp()).get("/api/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-powered-by"], undefined);
  });
});
