import { planEnd } from "@redart/shared";
import { shortDate } from "./dates";

/** "Oct 1 – Oct 31" */
export function challengeDates(c: { start: string; days: number }): string {
  const year = new Date().getUTCFullYear();
  return `${shortDate(c.start, year)} – ${shortDate(planEnd(c), year)}`;
}
