// The shared Link table: one row per normalised URL, used by every reader's link checks.
import type { InspectResult, LinkStatus } from "@redart/shared";
import type { Db } from "../db";
import type { LinkStatus as DbLinkStatus } from "../generated/prisma/client";
import { cacheable, cacheTtl, type LinkCache } from "./inspect";

export class DbLinkCache implements LinkCache {
  constructor(private readonly db: Db, private readonly clock: () => number = Date.now) {}

  async get(key: string): Promise<InspectResult | undefined> {
    const row = await this.db.link.findUnique({ where: { urlKey: key } });
    if (!row) return undefined;
    const status = row.status.toLowerCase() as LinkStatus;
    if (this.clock() - row.checkedAt.getTime() > cacheTtl({ status })) return undefined;
    return {
      url: row.url, checkedAt: row.checkedAt.toISOString(), status, message: row.message,
      ...(row.httpStatus != null ? { httpStatus: row.httpStatus } : {}),
      ...(row.title != null ? { title: row.title } : {}),
      ...(row.words != null ? { words: row.words } : {}),
      minutes: row.minutes,
      confidence: row.minutes != null ? "high" : "low",
    };
  }

  async set(key: string, r: InspectResult): Promise<void> {
    if (!cacheable(r) || r.status === "rate_limited") return;
    const data = {
      url: r.url, title: r.title ?? null, minutes: r.minutes ?? null, words: r.words ?? null,
      status: r.status.toUpperCase() as DbLinkStatus, httpStatus: r.httpStatus ?? null, message: r.message, checkedAt: new Date(r.checkedAt),
    };
    await this.db.link.upsert({ where: { urlKey: key }, create: { urlKey: key, ...data }, update: data });
  }
}
