import { Router } from "express";
import { resetConfirmBody, resetRequestBody, signinBody, signupBody, type AuthOptions } from "@redart/shared";
import type { Db } from "../db";
import type { AppConfig } from "../config";
import { parse } from "../middleware/validate";
import { HttpError } from "../middleware/errors";
import { requireUser, currentUser } from "../middleware/auth";
import { perHour, perMinute } from "../middleware/rateLimits";
import { dummyHash, hashPassword, verifyPassword } from "../services/passwords";
import { clearSessionCookie, createSession, hashToken, newToken, setSessionCookie } from "../services/sessions";
import { toMe } from "../services/dto";
import { Prisma } from "../generated/prisma/client";

const RESET_MINUTES = 30;

export function authRouter(db: Db, config: AppConfig): Router {
  const r = Router();
  const signinLimit = perMinute(10, "Too many sign-in attempts. Wait a minute and try again.");
  const signupLimit = perHour(5, "Too many new accounts from this network. Try again later.");
  const resetLimit = perHour(5, "Too many reset requests. Try again later.");

  r.get("/auth/options", (_req, res) => {
    const body: AuthOptions = { passwordReset: !!config.mailer };
    res.json(body);
  });

  r.post("/auth/signup", signupLimit, async (req, res) => {
    const body = parse(signupBody, req.body);
    const taken = await db.user.findFirst({ where: { OR: [{ email: body.email }, { handle: body.handle }] }, select: { email: true, handle: true } });
    if (taken?.handle === body.handle) throw new HttpError(409, "CONFLICT", "That handle is taken. Try another one.", { handle: "That handle is taken." });
    if (taken) throw new HttpError(409, "CONFLICT", "There's already an account with that email. Sign in instead.", { email: "Already registered." });
    const user = await db.user.create({
      data: {
        email: body.email, handle: body.handle, displayName: body.displayName,
        passwordHash: await hashPassword(body.password), isAdmin: config.adminEmails.includes(body.email),
      },
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "CONFLICT", "That email or handle was just taken. Try again.");
      throw e;
    });
    const s = await createSession(db, user.id);
    setSessionCookie(res, config, s.token, s.expiresAt);
    res.status(201).json({ user: toMe(user) });
  });

  r.post("/auth/signin", signinLimit, async (req, res) => {
    const body = parse(signinBody, req.body);
    const user = await db.user.findUnique({ where: { email: body.email } });
    // Same work and the same answer whether or not the account exists.
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), body.password);
    if (!user || !ok) throw new HttpError(401, "UNAUTHORIZED", "That email and password don't match.");
    const s = await createSession(db, user.id);
    setSessionCookie(res, config, s.token, s.expiresAt);
    res.json({ user: toMe(user) });
  });

  r.post("/auth/signout", async (req, res) => {
    if (req.sessionId) await db.session.deleteMany({ where: { id: req.sessionId } });
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  r.post("/auth/signout-all", requireUser, async (req, res) => {
    await db.session.deleteMany({ where: { userId: currentUser(req).id } });
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  r.post("/auth/reset/request", resetLimit, async (req, res) => {
    if (!config.mailer) throw new HttpError(404, "NOT_FOUND", "Password reset by email isn't set up on this site.");
    const { email } = parse(resetRequestBody, req.body);
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      const token = newToken();
      await db.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
      const link = `${config.appOrigin}/reset?token=${token}`;
      await config.mailer.send(user.email, "Reset your Redart password",
        `Hi ${user.displayName},\n\nSomeone (hopefully you) asked to reset the password for your Redart account.\n\n${link}\n\nThe link works for ${RESET_MINUTES} minutes. If you didn't ask for this, ignore this email; your password stays the same.\n`);
    }
    // The same answer either way, so this can't be used to find out who has an account.
    res.json({ ok: true });
  });

  r.post("/auth/reset/confirm", resetLimit, async (req, res) => {
    if (!config.mailer) throw new HttpError(404, "NOT_FOUND", "Password reset by email isn't set up on this site.");
    const body = parse(resetConfirmBody, req.body);
    const reset = await db.passwordReset.findUnique({ where: { tokenHash: hashToken(body.token) } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw new HttpError(400, "VALIDATION", "That reset link has expired or was already used. Ask for a new one.");
    const passwordHash = await hashPassword(body.password);
    await db.$transaction([
      db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      db.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      db.session.deleteMany({ where: { userId: reset.userId } }), // sign out everywhere
    ]);
    res.json({ ok: true });
  });

  return r;
}
