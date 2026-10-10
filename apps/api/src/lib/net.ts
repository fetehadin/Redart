// Network safety helpers for the link inspector.
// The inspector fetches URLs that strangers type in, so it must never be
// usable to reach private networks (SSRF). Every hop of a redirect chain
// goes through validateTarget() before it is requested.

import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export const ALLOWED_PORTS = new Set(["", "80", "443"]);
export const MAX_URL_LENGTH = 2048;

/** Parse and normalise a user-supplied URL. Returns a URL or throws InspectError. */
export function parseUserUrl(raw: unknown): URL {
  if (typeof raw !== "string") throw new InspectError("invalid", "Missing link.");
  let s = raw.trim();
  if (!s) throw new InspectError("invalid", "Missing link.");
  if (s.length > MAX_URL_LENGTH) throw new InspectError("invalid", "That link is too long.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s; // "example.com/post" -> https
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new InspectError("invalid", "That doesn't look like a web address.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new InspectError("invalid", "Only http and https links can be checked.");
  if (u.username || u.password)
    throw new InspectError("invalid", "Links with a username or password can't be checked.");
  if (!u.hostname || !u.hostname.includes(".") && !net.isIP(u.hostname))
    throw new InspectError("invalid", "That address has no real domain.");
  if (!ALLOWED_PORTS.has(u.port))
    throw new InspectError("blocked", "Only standard web ports can be checked.");
  u.hash = "";
  return u;
}

/** True when an IP address points somewhere private, local or reserved. */
export function isBlockedAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedV4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    // IPv4-mapped / translated forms: ::ffff:10.0.0.1, ::ffff:a00:1
    const mapped = lower.match(/^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedV4(mapped[1]!);
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const a = parseInt(hexMapped[1]!, 16), b = parseInt(hexMapped[2]!, 16);
      return isBlockedV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
    }
    if (lower === "::" || lower === "::1") return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (lower.startsWith("2001:db8")) return true; // documentation
    if (lower.startsWith("100::")) return true;    // discard prefix
    return false;
  }
  return true; // not an IP at all: refuse
}

function isBlockedV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p as [number, number, number, number];
  return (
    a === 0 ||                              // "this" network
    a === 10 ||                             // private
    a === 127 ||                            // loopback
    (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
    (a === 169 && b === 254) ||             // link local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||    // private
    (a === 192 && b === 0 && c === 0) ||    // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) ||    // documentation
    (a === 192 && b === 88 && c === 99) ||  // 6to4 relay
    (a === 192 && b === 168) ||             // private
    (a === 198 && (b === 18 || b === 19)) ||// benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) ||  // documentation
    a >= 224                                // multicast + reserved + broadcast
  );
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa"];

/**
 * Throw unless the URL's host resolves only to public addresses.
 * `lookup` is injectable for tests.
 */
export type Lookup = (host: string) => Promise<string[]>;

export async function validateTarget(u: URL, lookup: Lookup = defaultLookup): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)))
    throw new InspectError("blocked", "Private or local addresses can't be checked.");
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new InspectError("unreachable", "That website's domain doesn't exist or can't be found.");
    }
  }
  if (!addresses.length)
    throw new InspectError("unreachable", "That website's domain doesn't exist or can't be found.");
  if (addresses.some(isBlockedAddress))
    throw new InspectError("blocked", "Private or local addresses can't be checked.");
}

async function defaultLookup(host: string): Promise<string[]> {
  const res = await dnsLookup(host, { all: true, verbatim: true });
  return res.map((r) => r.address);
}

export type InspectErrorStatus = "invalid" | "blocked" | "unreachable" | "timeout" | "broken";

export class InspectError extends Error {
  constructor(public readonly status: InspectErrorStatus, message: string) {
    super(message);
  }
}
