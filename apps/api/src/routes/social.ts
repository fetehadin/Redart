import { Router, type Request } from "express";
import { recommendBody, type ArticleRef, type FeedItem, type InboxRecommendation, type NotificationItem, type Page, type UserCard } from "@redart/shared";
import type { Db } from "../db";
import type { Prisma, User } from "../generated/prisma/client";
import { currentUser, requireUser } from "../middleware/auth";
import { HttpError } from "../middleware/errors";
import { perHourPerUser } from "../middleware/rateLimits";
import { parse } from "../middleware/validate";
import { accessTo, blockedIds } from "../services/visibility";
import { notify } from "../services/notifications";

const card = (u: Pick<User, "handle" | "displayName" | "bio" | "visibility">): UserCard =>
  ({ handle: u.handle, displayName: u.displayName, bio: u.bio, visibility: u.visibility, relationship: null });

const limitOf = (req: Request, def = 20) => {
  const n = Number(req.query.limit);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 50) : def;
};
const cursorOf = (req: Request) => (typeof req.query.cursor === "string" && /^[0-9a-f-]{36}$/i.test(req.query.cursor) ? req.query.cursor : undefined);

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : null);
const articleRef = (p: Payload): ArticleRef => ({ title: str(p.title), url: str(p.url), minutes: num(p.minutes), topic: str(p.topic) });

type ActivityRow = Prisma.ActivityGetPayload<{ include: { user: true } }>;

function feedItem(a: ActivityRow): FeedItem | null {
  const p = (a.payload ?? {}) as Payload;
  const base = { id: a.id, createdAt: a.createdAt.toISOString(), actor: card(a.user) };
  switch (a.kind) {
    case "FINISHED": return { ...base, kind: "FINISHED", article: articleRef(p), planName: str(p.planName) };
    case "FAVORITED": return { ...base, kind: "FAVORITED", article: articleRef(p) };
    case "RECOMMENDED": return { ...base, kind: "RECOMMENDED", article: articleRef(p), message: str(p.message) };
    case "STARTED_PLAN": return { ...base, kind: "STARTED_PLAN", planName: str(p.name), days: num(p.days) ?? 0, articles: num(p.articles) ?? 0 };
    case "JOINED_CHALLENGE": return { ...base, kind: "JOINED_CHALLENGE", challenge: { slug: str(p.slug), title: str(p.title) }, track: str(p.track) };
    default: return null;
  }
}

type RecRow = Prisma.RecommendationGetPayload<{ include: { from: true } }>;
const inboxRec = (r: RecRow): InboxRecommendation => ({
  id: r.id, from: card(r.from), message: r.message, createdAt: r.createdAt.toISOString(), read: !!r.readAt,
  article: { title: r.title, url: r.url, minutes: r.minutes, topic: "" },
});

export function socialRouter(db: Db): Router {
  const r = Router();

  /* ---------- feed: what the people you follow did, newest first ---------- */

  r.get("/feed", requireUser, async (req, res) => {
    const me = currentUser(req);
    const [follows, hide] = await Promise.all([
      db.follow.findMany({ where: { followerId: me.id, status: "ACCEPTED" }, select: { followeeId: true } }),
      blockedIds(db, me.id),
    ]);
    const ids = follows.map((f) => f.followeeId).filter((id) => !hide.includes(id));
    const limit = limitOf(req);
    const cursor = cursorOf(req);
    const rows = ids.length ? await db.activity.findMany({
      // Activity tied to a hidden plan never shows.
      where: { userId: { in: ids }, OR: [{ planId: null }, { plan: { visibleToFollowers: true } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: true },
    }) : [];
    const more = rows.length > limit;
    const kept = more ? rows.slice(0, limit) : rows;
    const body: Page<FeedItem> & { following: number } = {
      items: kept.map(feedItem).filter((x): x is FeedItem => !!x),
      nextCursor: more ? kept[kept.length - 1]!.id : null,
      following: ids.length,
    };
    res.set("cache-control", "no-store").json(body);
  });

  /* ---------- recommendations ---------- */

  r.post("/recommendations", requireUser, perHourPerUser(30, "That's a lot of recommendations in an hour. Try again later."), async (req, res) => {
    const me = currentUser(req);
    const body = parse(recommendBody, req.body);
    const data = { fromUserId: me.id, url: body.url, title: body.title, minutes: body.minutes ?? null, message: body.message ?? "" };

    if (body.toHandle) {
      const to = await db.user.findUnique({ where: { handle: body.toHandle.replace(/^@/, "") } });
      if (!to || to.id === me.id) throw new HttpError(404, "NOT_FOUND", "There's no reader with that handle.");
      // Only to someone who follows you: nobody gets recommendations from strangers.
      const access = await accessTo(db, me.id, to);
      if (access.blockedEitherWay || access.relationship?.followsYou !== "accepted")
        throw new HttpError(403, "FORBIDDEN", `You can recommend directly only to people who follow you.`);
      const rec = await db.recommendation.create({ data: { ...data, toUserId: to.id } });
      await notify(db, to.id, me.id, "RECOMMENDATION", rec.id);
      res.status(201).json({ id: rec.id, to: to.handle });
      return;
    }

    const rec = await db.recommendation.create({ data });
    await db.activity.create({
      data: { userId: me.id, kind: "RECOMMENDED", payload: { recommendationId: rec.id, title: rec.title, url: rec.url, minutes: rec.minutes, topic: body.topic ?? "", message: rec.message } },
    });
    res.status(201).json({ id: rec.id, to: null });
  });

  r.get("/inbox/recommendations", requireUser, async (req, res) => {
    const me = currentUser(req);
    const hide = await blockedIds(db, me.id);
    const rows = await db.recommendation.findMany({
      where: { toUserId: me.id, fromUserId: { notIn: hide } }, orderBy: { createdAt: "desc" }, take: 50, include: { from: true },
    });
    res.json({ items: rows.map(inboxRec) });
  });

  /* ---------- notifications ---------- */

  r.get("/notifications", requireUser, async (req, res) => {
    const me = currentUser(req);
    const hide = await blockedIds(db, me.id);
    const limit = limitOf(req, 30);
    const cursor = cursorOf(req);
    const rows = await db.notification.findMany({
      where: { userId: me.id, actorId: { notIn: hide } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { actor: true, recommendation: { include: { from: true } } },
    });
    const more = rows.length > limit;
    const kept = more ? rows.slice(0, limit) : rows;
    const items: NotificationItem[] = kept.flatMap((n): NotificationItem[] => {
      const base = { id: n.id, actor: card(n.actor), createdAt: n.createdAt.toISOString(), read: !!n.readAt };
      if (n.kind === "RECOMMENDATION") return n.recommendation ? [{ ...base, kind: "RECOMMENDATION", recommendation: inboxRec(n.recommendation) }] : [];
      return [{ ...base, kind: n.kind }];
    });
    res.set("cache-control", "no-store").json({ items, nextCursor: more ? kept[kept.length - 1]!.id : null } satisfies Page<NotificationItem>);
  });

  r.get("/notifications/unread-count", requireUser, async (req, res) => {
    const me = currentUser(req);
    const hide = await blockedIds(db, me.id);
    const count = await db.notification.count({ where: { userId: me.id, readAt: null, actorId: { notIn: hide } } });
    res.set("cache-control", "no-store").json({ count });
  });

  r.post("/notifications/read", requireUser, async (req, res) => {
    const me = currentUser(req);
    const now = new Date();
    await db.$transaction([
      db.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: now } }),
      db.recommendation.updateMany({ where: { toUserId: me.id, readAt: null }, data: { readAt: now } }),
    ]);
    res.json({ ok: true });
  });

  return r;
}
