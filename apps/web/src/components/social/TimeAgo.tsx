"use client";
import { timeAgo } from "@/lib/timeAgo";

/** Relative time. The server's "now" can differ from the browser's by a minute, so mismatches are expected. */
export function TimeAgo({ iso }: { iso: string }) {
  return <time dateTime={iso} title={new Date(iso).toLocaleString()} suppressHydrationWarning>{timeAgo(iso)}</time>;
}
