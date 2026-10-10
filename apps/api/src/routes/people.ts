import { Router, type Request } from "express";
import {
  planEnd, searchQuery,
  type FinishedItem, type Page, type PlanSummary, type Profile, type PublicFavorite, type ReadingStats, type Relationship, type UserCard,
} from "@redart/shared";
import type { Db } from "../db";
import type { User } from "../generated/prisma/client";
import { currentUser, requireUser } from "../middleware/auth";
import { HttpError } from "../middleware/errors";
import { perHourPerUser } from "../middleware/rateLimits";
import { parse } from "../middleware/validate";
import { accessTo, blockedIds, type Access } from "../services/visibility";
import { notify } from "../services/notifications";
import { fromDbDate, serverToday } from "../lib/dates";

const PAGE = 20;

function limitOf(req: Request, max = 50): number {
  const n = Number(req.query.limit);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : PAGE;
}
const cursorOf = (req: Request) => (typeof req.query.cursor === "string" && /^[0-9a-f-]{36}$/i.test(req.query.cursor) ? req.query.cursor : undefined);

function pageOf<T extends { id: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  const more = rows.length > limit;
  const kept = more ? rows.slice(0, limit) : rows;
  return { rows: kept, nextCursor: more ? kept[kept.length - 1]!.id : null };
}

const card = (u: Pick<User, "handle" | "displayName" | "bio" | "visibility">, relationship: Relationship | null): UserCard =>
  ({ handle: u.handle, displayName: u.displayName, bio: u.bio, visibility: u.visibility, relationship });

/** Cards for a list of users, with the viewer's relationship to each, in two queries. */
async function cardsFor(db: Db, viewerId: string | null, users: Pick<User, "id" | "handle" | "displayName" | "bio" | "visibility">[]): Promise<UserCard[]> {
  if (!viewerId) return users.map((u) => card(u, null));
  const ids = users.map((u) => u.id);
  const [out, back] = await Promise.all([
    db.follow.findMany({ where: { followerId: viewerId, followeeId: { in: ids } }, select: { followeeId: true, status: true } }),
    db.follow.findMany({ where: { followeeId: viewerId, followerId: { in: ids } }, select: { followerId: true, status: true } }),
  ]);
  const st = (s?: string) => (s === "ACCEPTED" ? "accepted" : s === "PENDING" ? "pending" : "none") as Relationship["following"];
  return users.map((u) => card(u, {
    self: u.id === viewerId,
    following: st(out.find((f) => f.followeeId === u.id)?.status),
    followsYou: st(back.find((f) => f.followerId === u.id)?.status),
    blocked: false,
  }));
}

export function peopleRouter(db: Db): Router {
  const r = Router();
  const followLimit = () => perHourPerUser(60, "You're following a lot of people quickly. Try again later.");

  /** The profile owner, or 404 when missing or when they've blocked the viewer. */
  async function target(req: Request): Promise<{ owner: User; access: Access }> {
    const handle = String(req.params.handle ?? "").toLowerCase();
    const owner = await db.user.findUnique({ where: { handle } });
    if (!owner) throw new HttpError(404, "NOT_FOUND", "There's no reader with that handle.");
    const access = await accessTo(db, req.user?.id ?? null, owner);
    if (access.hiddenFromViewer) throw new HttpError(404, "NOT_FOUND", "There's no reader with that handle.");
    return { owner, access };
  }
  async function readable(req: Request) {
    const t = await target(req);
    if (!t.access.canSeeReading) throw new HttpError(403, "FORBIDDEN", t.access.relationship ? "This account is private." : "Sign in to see what this reader is reading.");
    return t;
  }
  /** Plans the viewer may see: all of them for the owner, shared ones for everyone else. */
  const planFilter = (owner: User, viewerId: string | null) =>
    (viewerId === owner.id ? { userId: owner.id } : { userId: owner.id, visibleToFollowers: true });

  /* ---------- search ---------- */

  r.get("/users/search", requireUser, async (req, res) => {
    const { q } = parse(searchQuery, req.query);
    const me = currentUser(req);
    const hide = await blockedIds(db, me.id);
    const users = await db.user.findMany({
      where: {
        id: { notIn: hide },
        OR: [{ handle: { startsWith: q.toLowerCase().replace(/^@/, "") } }, { displayName: { contains: q, mode: "insensitive" } }],
      },
      orderBy: { handle: "asc" }, take: 20,
    });
    res.json({ items: await cardsFor(db, me.id, users) });
  });

  /* ---------- profiles ---------- */

  r.get("/users/:handle", async (req, res) => {
    const { owner, access } = await target(req);
    const [followers, following] = await Promise.all([
      db.follow.count({ where: { followeeId: owner.id, status: "ACCEPTED" } }),
      db.follow.count({ where: { followerId: owner.id, status: "ACCEPTED" } }),
    ]);
    let stats: ReadingStats | null = null;
    if (access.canSeeReading) {
      const where = { done: true, plan: planFilter(owner, req.user?.id ?? null) };
      const monthStart = new Date(`${serverToday().slice(0, 7)}-01T00:00:00Z`);
      const [all, month] = await Promise.all([
        db.article.aggregate({ where, _count: { _all: true }, _sum: { minutes: true } }),
        db.article.aggregate({ where: { ...where, doneAt: { gte: monthStart } }, _count: { _all: true }, _sum: { minutes: true } }),
      ]);
      stats = {
        articlesRead: all._count._all, minutesRead: all._sum.minutes ?? 0,
        articlesThisMonth: month._count._all, minutesThisMonth: month._sum.minutes ?? 0,
      };
    }
    const body: Profile = {
      ...card(owner, access.relationship), followers, following, joinedAt: owner.createdAt.toISOString(),
      canSeeReading: access.canSeeReading, stats,
    };
    res.set("cache-control", "no-store").json(body);
  });

  r.get("/users/:handle/plans", async (req, res) => {
    const { owner } = await readable(req);
    const plans = await db.plan.findMany({
      where: planFilter(owner, req.user?.id ?? null), orderBy: { start: "desc" }, take: 12,
      select: { id: true, name: true, start: true, days: true, articles: { select: { done: true, minutes: true } } },
    });
    const items: PlanSummary[] = plans.map((p) => ({
      id: p.id, name: p.name, start: fromDbDate(p.start), days: p.days,
      total: p.articles.length, done: p.articles.filter((a) => a.done).length,
      minutesAll: p.articles.reduce((n, a) => n + a.minutes, 0),
      minutesDone: p.articles.filter((a) => a.done).reduce((n, a) => n + a.minutes, 0),
    }));
    // Current and upcoming plans first, then finished ones.
    const today = serverToday();
    items.sort((a, b) => Number(planEnd(a) < today) - Number(planEnd(b) < today) || b.start.localeCompare(a.start));
    res.json({ items });
  });

  r.get("/users/:handle/finished", async (req, res) => {
    const { owner } = await readable(req);
    const limit = limitOf(req);
    const cursor = cursorOf(req);
    const rows = await db.article.findMany({
      where: { done: true, plan: planFilter(owner, req.user?.id ?? null) },
      orderBy: [{ doneAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, title: true, url: true, topic: true, minutes: true, doneAt: true, updatedAt: true, plan: { select: { name: true } } },
    });
    const { rows: kept, nextCursor } = pageOf(rows, limit);
    const body: Page<FinishedItem> = {
      items: kept.map((a) => ({ id: a.id, title: a.title, url: a.url, topic: a.topic, minutes: a.minutes, doneAt: a.doneAt ? fromDbDate(a.doneAt) : fromDbDate(a.updatedAt), planName: a.plan.name })),
      nextCursor,
    };
    res.json(body);
  });

  r.get("/users/:handle/favorites", async (req, res) => {
    const { owner } = await readable(req);
    const limit = limitOf(req);
    const cursor = cursorOf(req);
    const rows = await db.favorite.findMany({
      where: { userId: owner.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const { rows: kept, nextCursor } = pageOf(rows, limit);
    const body: Page<PublicFavorite> = {
      items: kept.map((f) => ({ id: f.id, title: f.title, url: f.url, topic: f.topic, minutes: f.minutes, savedAt: fromDbDate(f.savedAt) })),
      nextCursor,
    };
    res.json(body);
  });

  r.get("/users/:handle/challenges", async (req, res) => {
    const { owner } = await readable(req);
    const self = req.user?.id === owner.id;
    const rows = await db.challengeParticipant.findMany({
      // Invite-only challenges are listed only to the reader themselves; hidden plans hide their challenge too.
      where: { userId: owner.id, ...(self ? {} : { challenge: { access: "PUBLIC" }, plan: { visibleToFollowers: true } }) },
      include: { challenge: true, track: true }, orderBy: { joinedAt: "desc" }, take: 20,
    });
    res.json({ items: rows.map((p) => ({ slug: p.challenge.slug, title: p.challenge.title, start: fromDbDate(p.challenge.start), days: p.challenge.days, track: p.track.name })) });
  });

  for (const dir of ["followers", "following"] as const) {
    r.get(`/users/:handle/${dir}`, async (req, res) => {
      const { owner } = await readable(req);
      const viewerId = req.user?.id ?? null;
      const hide = viewerId ? await blockedIds(db, viewerId) : [];
      const limit = limitOf(req);
      const where = dir === "followers"
        ? { followeeId: owner.id, status: "ACCEPTED" as const, followerId: { notIn: hide } }
        : { followerId: owner.id, status: "ACCEPTED" as const, followeeId: { notIn: hide } };
      const [rows, total] = await Promise.all([
        db.follow.findMany({ where, include: { follower: true, followee: true }, orderBy: { createdAt: "desc" }, take: limit }),
        db.follow.count({ where }),
      ]);
      const users = rows.map((f) => (dir === "followers" ? f.follower : f.followee));
      res.json({ items: await cardsFor(db, viewerId, users), total });
    });
  }

  /* ---------- following ---------- */

  r.post("/users/:handle/follow", requireUser, followLimit(), async (req, res) => {
    const me = currentUser(req);
    const { owner, access } = await target(req);
    if (owner.id === me.id) throw new HttpError(400, "VALIDATION", "You can't follow yourself.");
    if (access.blockedEitherWay) throw new HttpError(403, "FORBIDDEN", "You can't follow this reader.");
    if (access.relationship?.following !== "none") { res.json({ following: access.relationship!.following }); return; }
    const status = owner.visibility === "PRIVATE" ? "PENDING" : "ACCEPTED";
    await db.follow.create({ data: { followerId: me.id, followeeId: owner.id, status } }).catch(() => { /* double click: already there */ });
    await notify(db, owner.id, me.id, status === "PENDING" ? "FOLLOW_REQUEST" : "NEW_FOLLOWER");
    res.status(201).json({ following: status === "PENDING" ? "pending" : "accepted" });
  });

  r.delete("/users/:handle/follow", requireUser, async (req, res) => {
    const me = currentUser(req);
    const { owner } = await target(req);
    await db.follow.deleteMany({ where: { followerId: me.id, followeeId: owner.id } });
    res.json({ following: "none" });
  });

  r.get("/follow-requests", requireUser, async (req, res) => {
    const me = currentUser(req);
    const rows = await db.follow.findMany({ where: { followeeId: me.id, status: "PENDING" }, include: { follower: true }, orderBy: { createdAt: "desc" } });
    res.json({ items: await cardsFor(db, me.id, rows.map((f) => f.follower)) });
  });

  r.post("/follow-requests/:handle/:decision", requireUser, async (req, res) => {
    const me = currentUser(req);
    const decision = req.params.decision;
    if (decision !== "accept" && decision !== "decline") throw new HttpError(404, "NOT_FOUND", "There's nothing here.");
    const follower = await db.user.findUnique({ where: { handle: String(req.params.handle).toLowerCase() } });
    const pending = follower && await db.follow.findUnique({ where: { followerId_followeeId: { followerId: follower.id, followeeId: me.id } } });
    if (!follower || !pending || pending.status !== "PENDING") throw new HttpError(404, "NOT_FOUND", "That request isn't waiting anymore.");
    if (decision === "accept") {
      await db.follow.update({ where: { followerId_followeeId: { followerId: follower.id, followeeId: me.id } }, data: { status: "ACCEPTED" } });
      await notify(db, follower.id, me.id, "FOLLOW_ACCEPTED");
    } else {
      await db.follow.delete({ where: { followerId_followeeId: { followerId: follower.id, followeeId: me.id } } });
    }
    // The request notification has done its job either way.
    await db.notification.deleteMany({ where: { userId: me.id, actorId: follower.id, kind: "FOLLOW_REQUEST" } });
    res.json({ ok: true });
  });

  r.delete("/followers/:handle", requireUser, async (req, res) => {
    const me = currentUser(req);
    const follower = await db.user.findUnique({ where: { handle: String(req.params.handle).toLowerCase() }, select: { id: true } });
    if (follower) await db.follow.deleteMany({ where: { followerId: follower.id, followeeId: me.id } });
    res.json({ ok: true });
  });

  /* ---------- blocking ---------- */

  r.post("/users/:handle/block", requireUser, async (req, res) => {
    const me = currentUser(req);
    const { owner } = await target(req);
    if (owner.id === me.id) throw new HttpError(400, "VALIDATION", "You can't block yourself.");
    await db.$transaction([
      db.block.upsert({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: owner.id } }, create: { blockerId: me.id, blockedId: owner.id }, update: {} }),
      db.follow.deleteMany({ where: { OR: [{ followerId: me.id, followeeId: owner.id }, { followerId: owner.id, followeeId: me.id }] } }),
      db.notification.deleteMany({ where: { OR: [{ userId: me.id, actorId: owner.id }, { userId: owner.id, actorId: me.id }] } }),
    ]);
    res.json({ blocked: true });
  });

  r.delete("/users/:handle/block", requireUser, async (req, res) => {
    const me = currentUser(req);
    const owner = await db.user.findUnique({ where: { handle: String(req.params.handle).toLowerCase() }, select: { id: true } });
    if (owner) await db.block.deleteMany({ where: { blockerId: me.id, blockedId: owner.id } });
    res.json({ blocked: false });
  });

  r.get("/blocks", requireUser, async (req, res) => {
    const me = currentUser(req);
    const rows = await db.block.findMany({ where: { blockerId: me.id }, include: { blocked: true }, orderBy: { createdAt: "desc" } });
    res.json({ items: rows.map((b) => card(b.blocked, { self: false, following: "none", followsYou: "none", blocked: true })) });
  });

  return r;
}
