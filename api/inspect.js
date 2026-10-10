// GET /api/inspect?url=<article link>
// Checks whether a link works and estimates how long the article takes to read.
// Runs as a Vercel Node.js serverless function. No dependencies.

import { parseUserUrl, validateTarget, InspectError } from "./_lib/net.js";
import { analyzeHtml } from "./_lib/extract.js";

const TIMEOUT_MS = 9000;          // whole request budget, all redirects included
const MAX_BYTES = 3 * 1024 * 1024; // stop reading a page after 3 MB
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; RedartLinkCheck/1.0; +https://github.com/fetehadin/Redart)";

/**
 * Inspect one URL. Pure apart from the network; `deps` lets tests inject fakes.
 * Always resolves to a result object (never throws).
 */
export async function inspect(rawUrl, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const lookup = deps.lookup;
  const now = deps.now || (() => new Date());
  const base = { url: typeof rawUrl === "string" ? rawUrl.trim() : "", checkedAt: now().toISOString() };

  let u;
  try {
    u = parseUserUrl(rawUrl);
  } catch (e) {
    return { ...base, status: e.status || "invalid", message: e.message };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    let current = u;
    let res;
    for (let hop = 0; ; hop++) {
      await validateTarget(current, lookup);
      res = await fetchImpl(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en;q=0.9,*;q=0.5",
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) {
          await discard(res);
          return { ...base, status: "broken", httpStatus: res.status, message: "The link redirects too many times." };
        }
        let next;
        try {
          next = new URL(res.headers.get("location"), current);
        } catch {
          await discard(res);
          return { ...base, status: "broken", httpStatus: res.status, message: "The link redirects to an invalid address." };
        }
        await discard(res);
        // Re-validate the new hop exactly like user input.
        current = parseUserUrl(next.href);
        continue;
      }
      break;
    }

    const finalUrl = current.href;
    const httpStatus = res.status;
    const common = { ...base, finalUrl, httpStatus };

    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429 || httpStatus === 451) {
      await discard(res);
      return {
        ...common,
        status: "restricted",
        message: "The site blocked our automatic check. The link probably works in a browser; open it to confirm.",
      };
    }
    if (httpStatus === 404 || httpStatus === 410) {
      await discard(res);
      return { ...common, status: "broken", message: "This page doesn't exist anymore (error " + httpStatus + ")." };
    }
    if (httpStatus >= 400) {
      await discard(res);
      return {
        ...common,
        status: httpStatus >= 500 ? "unreachable" : "broken",
        message: httpStatus >= 500
          ? "The website is having problems right now (error " + httpStatus + "). Try again later."
          : "The link returned an error (" + httpStatus + ").",
      };
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/pdf")) {
      await discard(res);
      return { ...common, status: "ok", contentType: "pdf", title: titleFromPath(current), minutes: null, confidence: "low",
        message: "This is a PDF. Enter the read time yourself." };
    }
    if (contentType && !contentType.includes("html") && !contentType.includes("xml") && !contentType.startsWith("text/")) {
      await discard(res);
      return { ...common, status: "ok", contentType: contentType.split(";")[0], title: titleFromPath(current), minutes: null,
        confidence: "low", message: "The link works, but it isn't an article page." };
    }

    const html = await readText(res, MAX_BYTES, contentType);
    const a = analyzeHtml(html, current.hostname);
    return {
      ...common,
      status: "ok",
      contentType: "html",
      title: a.title || titleFromPath(current),
      siteName: a.siteName,
      words: a.words,
      minutes: a.minutes,
      confidence: a.confidence,
      message: a.minutes
        ? "Link works."
        : "Link works, but the page loads its text with JavaScript or needs a login, so we couldn't count the words. Enter the read time yourself.",
    };
  } catch (e) {
    if (e instanceof InspectError) return { ...base, status: e.status, message: e.message };
    if (e && (e.name === "AbortError" || controller.signal.aborted))
      return { ...base, status: "timeout", message: "The website took too long to answer. Try again later." };
    const code = e?.cause?.code || e?.code || "";
    if (/CERT|SSL|TLS/i.test(code))
      return { ...base, status: "unreachable", message: "The website's security certificate is invalid." };
    if (code === "ENOTFOUND" || code === "EAI_AGAIN")
      return { ...base, status: "unreachable", message: "That website's domain doesn't exist or can't be found." };
    return { ...base, status: "unreachable", message: "We couldn't connect to that website." };
  } finally {
    clearTimeout(timer);
  }
}

async function discard(res) {
  try { await res.body?.cancel(); } catch { /* ignore */ }
}

/** Read up to `limit` bytes of the body and decode with the page's charset. */
async function readText(res, limit, contentType) {
  const charset = (contentType.match(/charset=([^;]+)/) || [])[1]?.trim().replace(/["']/g, "") || "utf-8";
  let decoder;
  try { decoder = new TextDecoder(charset, { fatal: false }); } catch { decoder = new TextDecoder("utf-8"); }
  if (!res.body || !res.body.getReader) return decoder.decode(new Uint8Array(await res.arrayBuffer()).slice(0, limit));
  const reader = res.body.getReader();
  let received = 0;
  let out = "";
  while (received < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value.byteLength + received > limit ? value.subarray(0, limit - received) : value;
    received += chunk.byteLength;
    out += decoder.decode(chunk, { stream: true });
  }
  out += decoder.decode();
  try { await reader.cancel(); } catch { /* ignore */ }
  return out;
}

function titleFromPath(u) {
  const last = decodeURIComponentSafe(u.pathname.split("/").filter(Boolean).pop() || u.hostname);
  return last.replace(/\.(html?|php|aspx?|pdf)$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 200);
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/* ---------- best-effort rate limit (per warm instance) ---------- */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;
const hits = new Map();
export function rateLimited(ip, t = Date.now()) {
  const rec = hits.get(ip);
  if (!rec || t - rec.start > WINDOW_MS) { hits.set(ip, { start: t, n: 1 }); return false; }
  rec.n++;
  if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start > WINDOW_MS) hits.delete(k);
  return rec.n > MAX_PER_WINDOW;
}

/* ---------- HTTP handler (Vercel / plain Node) ---------- */
export default async function handler(req, res) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET");
    return res.end(JSON.stringify({ status: "invalid", message: "Use GET." }));
  }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    res.statusCode = 429;
    res.setHeader("retry-after", "60");
    res.setHeader("cache-control", "no-store");
    return res.end(JSON.stringify({ status: "rate_limited", message: "Too many checks in a minute. Wait a moment and try again." }));
  }
  const target = new URL(req.url, "http://localhost").searchParams.get("url");
  const result = await inspect(target);
  // Cache good answers at the edge so popular articles are checked once, not per visitor.
  const cache = result.status === "ok"
    ? "public, max-age=0, s-maxage=43200, stale-while-revalidate=86400"
    : result.status === "invalid" || result.status === "blocked"
      ? "public, max-age=0, s-maxage=86400"
      : "public, max-age=0, s-maxage=600";
  res.setHeader("cache-control", cache);
  res.statusCode = 200; // the outcome lives in result.status; 200 keeps edge caching simple
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(result));
}
