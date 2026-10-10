import { Router } from "express";
import type { Db } from "../db";

export function healthRouter(db: Db): Router {
  const r = Router();
  r.get("/health", async (_req, res) => {
    res.set("cache-control", "no-store");
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  return r;
}
