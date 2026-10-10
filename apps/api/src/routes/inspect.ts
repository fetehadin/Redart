import { Router } from "express";
import { urlKey } from "@redart/shared";
import { inspect, InspectCache, type InspectDeps } from "../services/inspect";
import { inspectLimit } from "../middleware/rateLimits";

/** GET /api/inspect?url=… — open to guests. */
export function inspectRouter(deps: InspectDeps = {}, cache = new InspectCache()): Router {
  const r = Router();
  r.get("/inspect", inspectLimit(), async (req, res) => {
    const raw = typeof req.query.url === "string" ? req.query.url : "";
    const key = urlKey(raw);
    const cached = key ? cache.get(key) : undefined;
    const result = cached ? { ...cached, url: raw.trim() } : await inspect(raw, deps);
    if (key && !cached) cache.set(key, result);
    res.set("cache-control", "no-store");
    // The outcome lives in result.status; a link being broken is not an API error.
    res.json(result);
  });
  return r;
}
