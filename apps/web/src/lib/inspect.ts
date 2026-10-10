// Talks to GET /api/inspect. Results that describe the link (not our own connection) are cached for the session.
import { urlKey, type InspectResult } from "@redart/shared";

export type ClientInspectStatus = InspectResult["status"] | "offline" | "unavailable" | "network";
export type ClientInspectResult = Omit<InspectResult, "status" | "url" | "checkedAt"> & {
  status: ClientInspectStatus;
  url?: string;
  checkedAt?: string;
};

let apiAvailable: boolean | null = null;
const cache = new Map<string, Promise<ClientInspectResult>>();
const FINAL = new Set<ClientInspectStatus>(["ok", "broken", "restricted", "unreachable", "invalid", "blocked"]);

export const linkChecksUnavailable = () => apiAvailable === false;

async function call(url: string): Promise<ClientInspectResult> {
  if (!navigator.onLine) return { status: "offline", message: "You're offline. The link will be checked when you reconnect." };
  if (apiAvailable === false) return { status: "unavailable", message: "Link checks aren't available right now." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`/api/inspect?url=${encodeURIComponent(url)}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const type = res.headers.get("content-type") || "";
    if (res.status === 404 || !type.includes("json")) {
      apiAvailable = false;
      return { status: "unavailable", message: "Link checks aren't available right now." };
    }
    apiAvailable = true;
    const data = await res.json();
    if (res.status === 429) return { status: "rate_limited", message: data?.error?.message || "Too many checks. Try again in a minute." };
    if (!res.ok) return { status: "network", message: "The link checker had a problem. Try again in a moment." };
    return data as InspectResult;
  } catch {
    return { status: "network", message: "Couldn't reach the link checker. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }
}

export function inspectUrl(url: string, force = false): Promise<ClientInspectResult> {
  const k = urlKey(url);
  if (!k) return Promise.resolve({ status: "invalid", message: "That doesn't look like a web address." });
  const hit = cache.get(k);
  if (!force && hit) return hit;
  const p = call(url).then((r) => { if (!FINAL.has(r.status)) cache.delete(k); return r; });
  cache.set(k, p);
  return p;
}

/** Results worth retrying soon because they describe our connection, not the link. */
export const isRetryable = (s: ClientInspectStatus) => s === "offline" || s === "network" || s === "rate_limited";
