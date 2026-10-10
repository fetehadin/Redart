import { Router } from "express";
import { urlKey } from "@redart/shared";
import { inspect, type InspectDeps, type LinkCache } from "../services/inspect";
import { inspectLimit } from "../middleware/rateLimits";

/** GET /api/inspect?url=… — open to guests. */
export function inspectRouter(cache: LinkCache, deps: InspectDeps = {}): Router {
  const r = Router();
  r.get("/inspect", inspectLimit(), async (req, res) => {
    const raw = typeof req.query.url === "string" ? req.query.url : "";
    const key = urlKey(raw);
    const cached = key ? await cache.get(key) : undefined;
    const result = cached ? { ...cached, url: raw.trim() } : await inspect(raw, deps);
    if (key && !cached) await cache.set(key, result).catch((err) => req.log?.warn({ err }, "link cache write failed"));
    res.set("cache-control", "no-store");
    // The outcome lives in result.status; a link being broken is not an API error.
    res.json(result);
  });
  return r;
}
