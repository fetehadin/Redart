import { rateLimit } from "express-rate-limit";
import { errorBody } from "./errors";

const perMinute = (limit: number, message: string) => rateLimit({
  windowMs: 60_000,
  limit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json(errorBody("RATE_LIMITED", message)); },
});

// Factories, so every app instance (and every test) gets its own counters.
export const inspectLimit = () => perMinute(40, "Too many link checks in a minute. Wait a moment and try again.");
