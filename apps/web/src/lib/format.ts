import { parseISO, type ISODate } from "@redart/shared";

/** "Oct 12", or "Oct 12, 2026" with the year. Client-side only: uses the reader's locale. */
export function fmtDate(s: ISODate, withYear = false): string {
  const d = parseISO(s);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
}
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const short = (s: string, n = 42) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
