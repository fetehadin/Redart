import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { errorBody } from "./errors";

let scale = 1;
/** Multiply every limit. Only the end-to-end test run raises it (RATE_LIMIT_SCALE), since all its users share one IP. */
export function setRateLimitScale(n: number) { scale = Math.max(1, n); }

// Factories, so every app instance (and every test) gets its own counters.
function limiter(windowMs: number, limit: number, message: string, key?: "user") {
  return rateLimit({
    windowMs, limit: limit * scale,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(key === "user" ? { keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "") } : {}),
    handler: (_req, res) => { res.status(429).json(errorBody("RATE_LIMITED", message)); },
  });
}

export const perMinute = (limit: number, message: string) => limiter(60_000, limit, message);
export const perHour = (limit: number, message: string) => limiter(3_600_000, limit, message);
export const perHourPerUser = (limit: number, message: string) => limiter(3_600_000, limit, message, "user");
export const inspectLimit = () => perMinute(40, "Too many link checks in a minute. Wait a moment and try again.");
