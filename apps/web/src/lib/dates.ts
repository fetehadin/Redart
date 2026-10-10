// Date formatting that gives the same text on the server and in the browser (no hydration mismatches).
const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const dayYear = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

const asDate = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);

/** "Oct 12" for YYYY-MM-DD or ISO timestamps; adds the year when it isn't `currentYear`. */
export function shortDate(s: string, currentYear?: number): string {
  const d = asDate(s);
  return (currentYear && d.getUTCFullYear() !== currentYear ? dayYear : day).format(d);
}
export const monthOf = (s: string) => monthYear.format(asDate(s));
