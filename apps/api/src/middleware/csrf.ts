import type { RequestHandler } from "express";
import { HttpError } from "./errors";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * State-changing requests must come from our own site. Browsers always send Origin on
 * cross-site POST/PATCH/DELETE, so a missing or foreign Origin is refused. This sits on top of SameSite=Lax cookies.
 */
export function requireSameOrigin(appOrigin: string): RequestHandler {
  const allowed = new URL(appOrigin).origin;
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get("origin") ?? (req.get("referer") ? safeOrigin(req.get("referer")!) : null);
    if (origin !== allowed) return next(new HttpError(403, "FORBIDDEN", "This request didn't come from Redart."));
    next();
  };
}

function safeOrigin(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}
