import type { Request } from "express";
import { parseISO, type ISODate } from "@redart/shared";
import { serverToday } from "./dates";

/** The reader's local date, sent by the client as ?today=YYYY-MM-DD. Falls back to the server's date. */
export function requestToday(req: Request): ISODate {
  const t = req.query.today;
  return typeof t === "string" && parseISO(t) ? t : serverToday();
}
