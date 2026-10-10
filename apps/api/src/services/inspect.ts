// Checks whether a link works and estimates how long the article takes to read.

import type { InspectResult } from "@redart/shared";
import { parseUserUrl, validateTarget, InspectError, type Lookup } from "../lib/net";
import { analyzeHtml } from "../lib/extract";
import { TextDecoder } from "node:util";

const TIMEOUT_MS = 9000;           // whole request budget, all redirects included
const MAX_BYTES = 3 * 1024 * 1024; // stop reading a page after 3 MB
const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; RedartLinkCheck/2.0; +https://github.com/fetehadin/Redart)";

export interface InspectDeps {
  fetch?: typeof globalThis.fetch;
  lookup?: Lookup;
  now?: () => Date;
  timeoutMs?: number;
}

/**
 * Inspect one URL. Pure apart from the network; `deps` lets tests inject fakes.
 * Always resolves to a result object (never throws).
 */
export async function inspect(rawUrl: unknown, deps: InspectDeps = {}): Promise<InspectResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const base = { url: typeof rawUrl === "string" ? rawUrl.trim() : "", checkedAt: now().toISOString() };

  let u: URL;
  try {
    u = parseUserUrl(rawUrl);
  } catch (e) {
    const err = e as InspectError;
    return { ...base, status: err.status ?? "invalid", message: err.message };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    let current = u;
    let res: Response;
    for (let hop = 0; ; hop++) {
      await validateTarget(current, deps.lookup);
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
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await discard(res);
        if (hop >= MAX_REDIRECTS)
          return { ...base, status: "broken", httpStatus: res.status, message: "The link redirects too many times." };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ...base, status: "broken", httpStatus: res.status, message: "The link redirects to an invalid address." };
        }
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
      return { ...common, status: "broken", message: `This page doesn't exist anymore (error ${httpStatus}).` };
    }
    if (httpStatus >= 400) {
      await discard(res);
      return httpStatus >= 500
        ? { ...common, status: "unreachable", message: `The website is having problems right now (error ${httpStatus}). Try again later.` }
        : { ...common, status: "broken", message: `The link returned an error (${httpStatus}).` };
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/pdf")) {
      await discard(res);
      return { ...common, status: "ok", contentType: "pdf", title: titleFromPath(current), minutes: null, confidence: "low",
        message: "This is a PDF. Enter the read time yourself." };
    }
    if (contentType && !contentType.includes("html") && !contentType.includes("xml") && !contentType.startsWith("text/")) {
      await discard(res);
      return { ...common, status: "ok", contentType: contentType.split(";")[0]!, title: titleFromPath(current), minutes: null,
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
    const err = e as { name?: string; code?: string; cause?: { code?: string } } | undefined;
    if (err?.name === "AbortError" || controller.signal.aborted)
      return { ...base, status: "timeout", message: "The website took too long to answer. Try again later." };
    const code = err?.cause?.code || err?.code || "";
    if (/CERT|SSL|TLS/i.test(code))
      return { ...base, status: "unreachable", message: "The website's security certificate is invalid." };
    if (code === "ENOTFOUND" || code === "EAI_AGAIN")
      return { ...base, status: "unreachable", message: "That website's domain doesn't exist or can't be found." };
    return { ...base, status: "unreachable", message: "We couldn't connect to that website." };
  } finally {
    clearTimeout(timer);
  }
}

async function discard(res: Response): Promise<void> {
  try { await res.body?.cancel(); } catch { /* ignore */ }
}

/** Read up to `limit` bytes of the body and decode with the page's charset. */
async function readText(res: Response, limit: number, contentType: string): Promise<string> {
  const charset = contentType.match(/charset=([^;]+)/)?.[1]?.trim().replace(/["']/g, "") || "utf-8";
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset, { fatal: false }); } catch { decoder = new TextDecoder("utf-8"); }
  if (!res.body) return decoder.decode(new Uint8Array(await res.arrayBuffer()).slice(0, limit));
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

function titleFromPath(u: URL): string {
  const last = decodeURIComponentSafe(u.pathname.split("/").filter(Boolean).pop() || u.hostname);
  return last.replace(/\.(html?|php|aspx?|pdf)$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 200);
}
function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

/* ---------- cache, so popular articles are fetched once, not once per reader ---------- */

const OK_TTL_MS = 12 * 3600_000;
const FINAL_TTL_MS = 24 * 3600_000; // invalid / blocked never change
const SHORT_TTL_MS = 10 * 60_000;

export function cacheTtl(r: Pick<InspectResult, "status">): number {
  if (r.status === "ok") return OK_TTL_MS;
  if (r.status === "invalid" || r.status === "blocked") return FINAL_TTL_MS;
  return SHORT_TTL_MS;
}
/** Timeouts and rate limits are likely transient; let the next reader retry. */
export const cacheable = (r: Pick<InspectResult, "status">) => r.status !== "timeout" && r.status !== "rate_limited";

export interface LinkCache {
  get(key: string): Promise<InspectResult | undefined>;
  set(key: string, result: InspectResult): Promise<void>;
}

/** In-process cache, used by tests and as a fallback. */
export class MemoryLinkCache implements LinkCache {
  private entries = new Map<string, InspectResult>();
  constructor(private readonly clock: () => number = Date.now, private readonly max = 5000) {}

  async get(key: string) {
    const r = this.entries.get(key);
    if (!r) return undefined;
    if (this.clock() - Date.parse(r.checkedAt) > cacheTtl(r)) { this.entries.delete(key); return undefined; }
    return r;
  }

  async set(key: string, result: InspectResult) {
    if (!cacheable(result)) return;
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, result);
  }
}
