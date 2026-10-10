import { Router } from "express";
import { changePasswordBody, deleteMeBody, importBody, updateMeBody, type ImportResult } from "@redart/shared";
import type { Db } from "../db";
import type { AppConfig } from "../config";
import { parse } from "../middleware/validate";
import { HttpError } from "../middleware/errors";
import { currentUser, requireUser } from "../middleware/auth";
import { hashPassword, verifyPassword } from "../services/passwords";
import { clearSessionCookie } from "../services/sessions";
import { importLedger } from "../services/ledger";
import { toMe } from "../services/dto";
import { requestToday } from "../lib/today";

export function meRouter(db: Db, config: AppConfig): Router {
  const r = Router();
  r.use("/me", requireUser);

  r.get("/me", (req, res) => { res.set("cache-control", "no-store").json({ user: toMe(currentUser(req)) }); });

  r.patch("/me", async (req, res) => {
    const me = currentUser(req);
    const body = parse(updateMeBody, req.body);
    if (body.handle && body.handle !== me.handle && await db.user.findUnique({ where: { handle: body.handle }, select: { id: true } }))
      throw new HttpError(409, "CONFLICT", "That handle is taken. Try another one.", { handle: "That handle is taken." });
    const user = await db.user.update({ where: { id: me.id }, data: body });
    // Going public: anyone waiting for approval becomes a follower.
    if (me.visibility === "PRIVATE" && user.visibility === "PUBLIC")
      await db.follow.updateMany({ where: { followeeId: me.id, status: "PENDING" }, data: { status: "ACCEPTED" } });
    res.json({ user: toMe(user) });
  });

  r.patch("/me/password", async (req, res) => {
    const me = currentUser(req);
    const body = parse(changePasswordBody, req.body);
    if (!(await verifyPassword(me.passwordHash, body.currentPassword)))
      throw new HttpError(400, "VALIDATION", "Your current password isn't right.", { currentPassword: "Not your current password." });
    await db.$transaction([
      db.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(body.newPassword) } }),
      // Other devices are signed out; this one stays signed in.
      db.session.deleteMany({ where: { userId: me.id, NOT: { id: req.sessionId } } }),
    ]);
    res.json({ ok: true });
  });

  r.delete("/me", async (req, res) => {
    const me = currentUser(req);
    const body = parse(deleteMeBody, req.body);
    if (!(await verifyPassword(me.passwordHash, body.password)))
      throw new HttpError(400, "VALIDATION", "That password isn't right.", { password: "Not your password." });
    await db.user.delete({ where: { id: me.id } }); // cascades to everything the user owns
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  r.post("/me/import", async (req, res) => {
    const body = parse(importBody, req.body);
    const result: ImportResult = await importLedger(db, currentUser(req).id, body.state, requestToday(req));
    res.json(result);
  });

  return r;
}
