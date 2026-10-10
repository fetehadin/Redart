import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect, rateLimited } from "../api/inspect.js";
import { isBlockedAddress, parseUserUrl } from "../api/_lib/net.js";
import { analyzeHtml, countWords, readingMinutes, extractTitle, decodeEntities } from "../api/_lib/extract.js";

const publicLookup = async () => ["93.184.216.34"];
const words = (n) => Array.from({ length: n }, (_, i) => "word" + (i % 50)).join(" ");
const page = (body, head = "<title>Hello</title>") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

function fakeFetch(routes) {
  return async (url) => {
    const r = routes[url];
    if (!r) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    if (r instanceof Error) throw r;
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? { "content-type": "text/html; charset=utf-8" } });
  };
}

/* ---------- SSRF guard ---------- */
test("blocks private, loopback, link-local and metadata addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:a00:1"])
    assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"])
    assert.equal(isBlockedAddress(ip), false, ip);
});

test("rejects bad or dangerous URLs before any network call", async () => {
  let called = false;
  const fetch = async () => { called = true; return new Response(""); };
  for (const [u, status] of [["", "invalid"], ["javascript:alert(1)", "invalid"], ["ftp://x.com/a", "invalid"], ["http://localhost/admin", "invalid"],
    ["http://user:pass@example.com", "invalid"], ["http://example.com:22/", "blocked"], ["http://127.0.0.1/", "blocked"], ["http://169.254.169.254/latest/meta-data", "blocked"]]) {
    const r = await inspect(u, { fetch, lookup: publicLookup });
    assert.equal(r.status, status, u);
  }
  assert.equal(called, false);
});

test("rejects a domain that resolves to a private address", async () => {
  const r = await inspect("https://sneaky.example.com", { fetch: fakeFetch({}), lookup: async () => ["10.0.0.5"] });
  assert.equal(r.status, "blocked");
});

test("re-checks every redirect hop", async () => {
  const fetch = fakeFetch({ "https://ok.example.com/": { status: 302, headers: { location: "http://127.0.0.1/secret" } } });
  const r = await inspect("https://ok.example.com/", { fetch, lookup: publicLookup });
  assert.equal(r.status, "blocked");
});

test("adds https:// when the scheme is missing", () => {
  assert.equal(parseUserUrl("martinfowler.com/bliki/MonolithFirst.html").href, "https://martinfowler.com/bliki/MonolithFirst.html");
});

/* ---------- outcomes ---------- */
test("working article: title, words and minutes", async () => {
  const body = `<nav>${words(400)}</nav><article><h1>Caching</h1><p>${words(2380)}</p></article><footer>${words(300)}</footer>`;
  const fetch = fakeFetch({ "https://blog.example.com/caching": { body: page(body, '<meta property="og:title" content="Caching &amp; You">') } });
  const r = await inspect("https://blog.example.com/caching", { fetch, lookup: publicLookup });
  assert.equal(r.status, "ok");
  assert.equal(r.title, "Caching & You");
  assert.ok(r.words >= 2380 && r.words < 2400, String(r.words)); // nav and footer ignored
  assert.equal(r.minutes, 10);
  assert.equal(r.confidence, "high");
});

test("follows redirects and reports the final URL", async () => {
  const fetch = fakeFetch({
    "http://example.com/a": { status: 301, headers: { location: "https://example.com/b" } },
    "https://example.com/b": { body: page(`<main>${words(500)}</main>`) },
  });
  const r = await inspect("http://example.com/a", { fetch, lookup: publicLookup });
  assert.equal(r.status, "ok");
  assert.equal(r.finalUrl, "https://example.com/b");
});

test("redirect loop ends as broken", async () => {
  const fetch = fakeFetch({ "https://loop.example.com/": { status: 302, headers: { location: "/" } } });
  const r = await inspect("https://loop.example.com/", { fetch, lookup: publicLookup });
  assert.equal(r.status, "broken");
});

test("404 is broken, 403 is restricted, 503 is unreachable", async () => {
  const fetch = fakeFetch({
    "https://a.example.com/x": { status: 404 }, "https://b.example.com/x": { status: 403 }, "https://c.example.com/x": { status: 503 },
  });
  assert.equal((await inspect("https://a.example.com/x", { fetch, lookup: publicLookup })).status, "broken");
  assert.equal((await inspect("https://b.example.com/x", { fetch, lookup: publicLookup })).status, "restricted");
  assert.equal((await inspect("https://c.example.com/x", { fetch, lookup: publicLookup })).status, "unreachable");
});

test("JavaScript-only page: link works but no estimate", async () => {
  const fetch = fakeFetch({ "https://spa.example.com/": { body: page('<div id="root"></div><script>app()</script>') } });
  const r = await inspect("https://spa.example.com/", { fetch, lookup: publicLookup });
  assert.equal(r.status, "ok");
  assert.equal(r.minutes, null);
  assert.equal(r.confidence, "low");
});

test("PDF links work without an estimate", async () => {
  const fetch = fakeFetch({ "https://x.example.com/paper.pdf": { body: "%PDF-1.4", headers: { "content-type": "application/pdf" } } });
  const r = await inspect("https://x.example.com/paper.pdf", { fetch, lookup: publicLookup });
  assert.equal(r.status, "ok");
  assert.equal(r.contentType, "pdf");
  assert.equal(r.title, "paper");
});

test("missing domain is unreachable", async () => {
  const r = await inspect("https://no-such-domain.example", { fetch: fakeFetch({}), lookup: async () => { throw new Error("ENOTFOUND"); } });
  assert.equal(r.status, "unreachable");
});

test("slow site times out", async () => {
  const fetch = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const r = await inspect("https://slow.example.com/", { fetch, lookup: publicLookup, timeoutMs: 50 });
  assert.equal(r.status, "timeout");
});

/* ---------- extraction ---------- */
test("reading time math", () => {
  assert.equal(readingMinutes(0), 1);
  assert.equal(readingMinutes(238), 1);
  assert.equal(readingMinutes(2380), 10);
  assert.equal(readingMinutes(2380, 12), 12); // images add up to 2 minutes
  assert.equal(readingMinutes(2380, 100), 12); // capped
});

test("counts words in Amharic and English", () => {
  assert.equal(countWords("Hello, world! It's fine."), 4);
  assert.ok(countWords("ሰላም ለዓለም እንዴት ናችሁ") >= 4);
});

test("prefers a publisher's declared word count when ours is truncated", () => {
  const html = page(`<article>${words(300)}</article><script type="application/ld+json">{"@type":"Article","wordCount":"4760"}</script>`);
  const a = analyzeHtml(html, "x.com");
  assert.equal(a.words, 4760);
  assert.equal(a.minutes, 20);
});

test("title fallbacks and entity decoding", () => {
  assert.equal(extractTitle("<title> A &#8211; B </title>"), "A – B");
  assert.equal(extractTitle('<meta content="Reversed" property="og:title"><title>no</title>'), "Reversed");
  assert.equal(decodeEntities("&lt;b&gt; &amp; &#x27;"), "<b> & '");
});

test("rate limit trips after 40 requests a minute", () => {
  const ip = "203.0.113.9";
  let tripped = false;
  for (let i = 0; i < 41; i++) tripped = rateLimited(ip, 1000);
  assert.equal(tripped, true);
  assert.equal(rateLimited(ip, 1000 + 61_000), false);
});
