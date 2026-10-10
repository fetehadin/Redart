import { Router } from "express";
import { ledgerOpsBody } from "@redart/shared";
import type { Db } from "../db";
import { parse } from "../middleware/validate";
import { currentUser, requireUser } from "../middleware/auth";
import { perMinute } from "../middleware/rateLimits";
import { applyOps, loadLedger } from "../services/ledger";
import { requestToday } from "../lib/today";

/** A member's own ledger: read it whole, change it with LedgerOps. */
export function ledgerRouter(db: Db): Router {
  const r = Router();
  r.use("/ledger", requireUser);

  r.get("/ledger", async (req, res) => {
    const state = await loadLedger(db, currentUser(req).id, requestToday(req));
    res.set("cache-control", "no-store").json({ state });
  });

  r.post("/ledger/ops", perMinute(600, "You're saving very fast. Wait a moment."), async (req, res) => {
    const { ops } = parse(ledgerOpsBody, req.body);
    const result = await applyOps(db, currentUser(req).id, ops, requestToday(req));
    res.json(result);
  });

  return r;
}
