import type { RequestHandler } from "express";
import type { Db } from "../db";
import type { AppConfig } from "../config";
import type { User } from "../generated/prisma/client";
import { parseCookies } from "../lib/cookies";
import { userForToken } from "../services/sessions";
import { HttpError } from "./errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point for Request
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

/** Attach req.user when the request carries a valid session cookie. Never rejects. */
export function loadSession(db: Db, config: AppConfig): RequestHandler {
  return async (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[config.cookieName];
    if (token) {
      const found = await userForToken(db, token);
      if (found) { req.user = found.user; req.sessionId = found.sessionId; }
    }
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "UNAUTHORIZED", "Sign in to do that."));
  next();
};

/** The signed-in user. Only call after requireUser. */
export function currentUser(req: { user?: User }): User {
  if (!req.user) throw new HttpError(401, "UNAUTHORIZED", "Sign in to do that.");
  return req.user;
}
