import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import type { Db } from "../db";
import type { AppConfig } from "../config";

export const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;
/** Extend a session at most once a day, so busy readers don't write on every request. */
const SLIDE_AFTER_MS = DAY_MS;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

/** The user for a session cookie, extending the session when it's due. Expired sessions are deleted. */
export async function userForToken(db: Db, token: string) {
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (now - session.lastUsedAt.getTime() > SLIDE_AFTER_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_DAYS * DAY_MS) } });
  }
  return { sessionId: session.id, user: session.user };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string, expiresAt: Date) {
  res.cookie(config.cookieName, token, {
    httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  res.clearCookie(config.cookieName, { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/" });
}
