import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import {
  articlesForTrack, challengeWhen, createChallengeBody, joinChallengeBody, leaderboardOptBody, retrack, slugify, switchTrackBody,
  TRACKS, trackTarget, uid, updateChallengeBody,
  type ChallengeDetail, type ChallengeSummary, type ChallengeWhen, type CuratedArticle, type ISODate, type LeaderboardRow, type UserCard,
} from "@redart/shared";
import type { Db } from "../db";
import type { Prisma, User } from "../generated/prisma/client";
import { currentUser, requireUser } from "../middleware/auth";
import { HttpError } from "../middleware/errors";
import { perHourPerUser } from "../middleware/rateLimits";
import { parse } from "../middleware/validate";
import { fromDbDate, toDbDate } from "../lib/dates";
import { requestToday } from "../lib/today";
import { articleFromRow, insertPlan, setDues, appendArticles } from "../services/ledger";
import { blockedIds } from "../services/visibility";

const card = (u: Pick<User, "handle" | "displayName" | "bio" | "visibility">): UserCard =>
  ({ handle: u.handle, displayName: u.displayName, bio: u.bio, visibility: u.visibility, relationship: null });

const withRelations = {
  createdBy: true,
  tracks: { orderBy: { position: "asc" } },
  _count: { select: { participants: true, articles: true } },
} satisfies Prisma.ChallengeInclude;
type ChallengeRow = Prisma.ChallengeGetPayload<{ include: typeof withRelations }>;

function summary(c: ChallengeRow, viewer: User | undefined, joinedTrack: string | null): ChallengeSummary {
  const mine = new Set((viewer?.topics ?? []).map((t) => t.toLowerCase()));
  return {
    slug: c.slug, title: c.title, description: c.description, start: fromDbDate(c.start), days: c.days, topics: c.topics,
    featured: c.featured, access: c.access, participants: c._count.participants, articleCount: c._count.articles,
    tracks: c.tracks.map((t) => ({ key: t.key as "light" | "steady" | "deep", name: t.name, description: t.description, targetArticles: t.targetArticles ?? 0 })),
    createdBy: card(c.createdBy), joined: joinedTrack,
    topicMatches: c.topics.filter((t) => mine.has(t.toLowerCase())).length,
  };
}

const curatedOf = (rows: { url: string; title: string; minutes: number | null; topic: string }[]): CuratedArticle[] =>
  rows.map((a) => ({ url: a.url, title: a.title, minutes: a.minutes, topic: a.topic }));

export function challengesRouter(db: Db): Router {
  const r = Router();

  /** A challenge the viewer may open: public ones, or invite-only ones they made, joined, or hold the code for. */
  async function visible(req: Request, slug: string) {
    const c = await db.challenge.findUnique({ where: { slug }, include: withRelations });
    if (!c) throw new HttpError(404, "NOT_FOUND", "There's no challenge here.");
    const viewer = req.user;
    const part = viewer ? await db.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId: c.id, userId: viewer.id } }, include: { track: true, plan: { include: { articles: true } } } }) : null;
    const invite = typeof req.query.invite === "string" ? req.query.invite : (req.body?.inviteCode as string | undefined);
    const allowed = c.access === "PUBLIC" || viewer?.id === c.createdById || !!part || (!!c.inviteCode && invite === c.inviteCode);
    if (!allowed) throw new HttpError(404, "NOT_FOUND", "There's no challenge here.");
    return { c, part };
  }
  const canEdit = (c: ChallengeRow, u?: User) => !!u && (u.id === c.createdById || u.isAdmin);

  /* ---------- listing ---------- */

  r.get("/challenges", async (req, res) => {
    const when: ChallengeWhen = req.query.when === "upcoming" || req.query.when === "past" ? req.query.when : "current";
    const today = requestToday(req);
    const viewer = req.user;
    const mineFilter: Prisma.ChallengeWhereInput[] = viewer ? [{ createdById: viewer.id }, { participants: { some: { userId: viewer.id } } }] : [];
    const rows = await db.challenge.findMany({
      where: {
        OR: [{ access: "PUBLIC" }, ...mineFilter],
        // Cheap date window in SQL; the exact current/past split happens below.
        ...(when === "upcoming" ? { start: { gt: toDbDate(today) } } : { start: { lte: toDbDate(today) } }),
      },
      include: withRelations,
      orderBy: { start: when === "upcoming" ? "asc" : "desc" },
      take: 100,
    });
    const joined = viewer ? await db.challengeParticipant.findMany({ where: { userId: viewer.id, challengeId: { in: rows.map((c) => c.id) } }, include: { track: true } }) : [];
    const items = rows
      .filter((c) => challengeWhen({ start: fromDbDate(c.start), days: c.days }, today) === when)
      .map((c) => summary(c, viewer, joined.find((j) => j.challengeId === c.id)?.track.key ?? null))
      // Featured first, then the reader's topics, then by date.
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.topicMatches - a.topicMatches || (when === "upcoming" ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)))
      .slice(0, 50);
    res.set("cache-control", "no-store").json({ items });
  });

  r.get("/challenges/:slug", async (req, res) => {
    const { c, part } = await visible(req, String(req.params.slug));
    const articles = await db.challengeArticle.findMany({ where: { challengeId: c.id }, orderBy: { position: "asc" } });
    const body: ChallengeDetail = {
      ...summary(c, req.user, part?.track.key ?? null),
      articles: curatedOf(articles),
      canEdit: canEdit(c, req.user),
      inviteCode: req.user?.id === c.createdById ? c.inviteCode : null,
      me: part ? {
        track: part.track.key, planId: part.planId, showOnLeaderboard: part.showOnLeaderboard,
        done: part.plan.articles.filter((a) => a.done).length, total: part.plan.articles.length,
      } : null,
    };
    res.set("cache-control", "no-store").json(body);
  });

  /* ---------- creating and editing ---------- */

  r.post("/challenges", requireUser, perHourPerUser(10, "That's a lot of new challenges. Try again later."), async (req, res) => {
    const me = currentUser(req);
    const body = parse(createChallengeBody, req.body);
    if (body.featured && !me.isAdmin) throw new HttpError(403, "FORBIDDEN", "Only admins can feature a challenge.");
    if (challengeWhen(body, requestToday(req)) === "past") throw new HttpError(400, "VALIDATION", "That challenge would already be over. Pick a later start date.", { start: "Already over." });
    let slug = slugify(body.title);
    if (await db.challenge.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${randomBytes(3).toString("hex")}`;
    const c = await db.challenge.create({
      data: {
        slug, title: body.title, description: body.description, start: toDbDate(body.start), days: body.days, topics: body.topics,
        access: body.access, inviteCode: body.access === "INVITE" ? randomBytes(9).toString("base64url") : null,
        featured: !!body.featured, createdById: me.id,
        tracks: { create: TRACKS.map((t, i) => ({ key: t.key, name: t.name, description: t.description, targetArticles: Math.min(trackTarget(t.rate, body.days), body.articles.length), position: i })) },
        articles: { create: body.articles.map((a, i) => ({ ...a, position: i })) },
      },
    });
    res.status(201).json({ slug: c.slug, inviteCode: c.inviteCode });
  });

  r.patch("/challenges/:slug", requireUser, async (req, res) => {
    const me = currentUser(req);
    const { c } = await visible(req, String(req.params.slug));
    if (!canEdit(c, me)) throw new HttpError(403, "FORBIDDEN", "Only the person who made this challenge can change it.");
    const body = parse(updateChallengeBody, req.body);
    if (body.featured !== undefined && !me.isAdmin) throw new HttpError(403, "FORBIDDEN", "Only admins can feature a challenge.");
    await db.challenge.update({ where: { id: c.id }, data: body });
    res.json({ ok: true });
  });

  /* ---------- joining, switching pace, leaving ---------- */

  r.post("/challenges/:slug/join", requireUser, async (req, res) => {
    const me = currentUser(req);
    const body = parse(joinChallengeBody, req.body);
    const { c, part } = await visible(req, String(req.params.slug));
    if (part) throw new HttpError(409, "CONFLICT", "You're already in this challenge.");
    const today = requestToday(req);
    const span = { start: fromDbDate(c.start), days: c.days };
    if (challengeWhen(span, today) === "past") throw new HttpError(400, "VALIDATION", "This challenge has finished.");
    const track = c.tracks.find((t) => t.key === body.track);
    if (!track) throw new HttpError(400, "VALIDATION", "Pick a pace.");
    const curated = curatedOf(await db.challengeArticle.findMany({ where: { challengeId: c.id }, orderBy: { position: "asc" } }));
    const planId = uid();
    await db.$transaction(async (tx) => {
      await insertPlan(tx, me.id, { id: planId, name: c.title.slice(0, 60), start: span.start, days: c.days, articles: articlesForTrack(span, curated, track.targetArticles ?? 1, today) });
      await tx.plan.update({ where: { id: planId }, data: { challengeId: c.id, trackId: track.id } });
      await tx.challengeParticipant.create({ data: { challengeId: c.id, userId: me.id, trackId: track.id, planId, showOnLeaderboard: body.showOnLeaderboard } });
      // Invite-only challenges stay out of feeds.
      if (c.access === "PUBLIC") {
        await tx.activity.create({ data: { userId: me.id, planId, kind: "JOINED_CHALLENGE", payload: { slug: c.slug, title: c.title, track: track.name } } });
      }
    }).catch((e) => {
      if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "CONFLICT", "You're already in this challenge.");
      throw e;
    });
    res.status(201).json({ planId });
  });

  r.post("/challenges/:slug/track", requireUser, async (req, res) => {
    const me = currentUser(req);
    const body = parse(switchTrackBody, req.body);
    const { c, part } = await visible(req, String(req.params.slug));
    if (!part) throw new HttpError(404, "NOT_FOUND", "You haven't joined this challenge.");
    const track = c.tracks.find((t) => t.key === body.track);
    if (!track) throw new HttpError(400, "VALIDATION", "Pick a pace.");
    if (track.id === part.trackId) { res.json({ added: 0 }); return; }
    const today: ISODate = requestToday(req);
    const curated = curatedOf(await db.challengeArticle.findMany({ where: { challengeId: c.id }, orderBy: { position: "asc" } }));
    const plan = { articles: [...part.plan.articles].sort((a, b) => a.position - b.position).map(articleFromRow) };
    const { added, dues } = retrack({ start: fromDbDate(c.start), days: c.days }, plan, curated, track.targetArticles ?? 1, today);
    await db.$transaction(async (tx) => {
      await appendArticles(tx, part.planId, added);
      await setDues(tx, part.planId, dues);
      await tx.challengeParticipant.update({ where: { challengeId_userId: { challengeId: c.id, userId: me.id } }, data: { trackId: track.id } });
      await tx.plan.update({ where: { id: part.planId }, data: { trackId: track.id } });
    });
    res.json({ added: added.length });
  });

  r.delete("/challenges/:slug/join", requireUser, async (req, res) => {
    const me = currentUser(req);
    const { c, part } = await visible(req, String(req.params.slug));
    if (!part) { res.json({ ok: true }); return; }
    // The plan stays in the reader's ledger; it just isn't part of the challenge anymore.
    await db.$transaction([
      db.challengeParticipant.delete({ where: { challengeId_userId: { challengeId: c.id, userId: me.id } } }),
      db.plan.update({ where: { id: part.planId }, data: { challengeId: null, trackId: null } }),
    ]);
    res.json({ ok: true });
  });

  r.patch("/challenges/:slug/me", requireUser, async (req, res) => {
    const me = currentUser(req);
    const body = parse(leaderboardOptBody, req.body);
    const { c, part } = await visible(req, String(req.params.slug));
    if (!part) throw new HttpError(404, "NOT_FOUND", "You haven't joined this challenge.");
    await db.challengeParticipant.update({ where: { challengeId_userId: { challengeId: c.id, userId: me.id } }, data: { showOnLeaderboard: body.showOnLeaderboard } });
    res.json({ ok: true });
  });

  /* ---------- leaderboard (opt-in only) ---------- */

  r.get("/challenges/:slug/leaderboard", async (req, res) => {
    const { c } = await visible(req, String(req.params.slug));
    const hide = req.user ? await blockedIds(db, req.user.id) : [];
    const rows = await db.challengeParticipant.findMany({
      where: { challengeId: c.id, showOnLeaderboard: true, userId: { notIn: hide } },
      include: { user: true, track: true, plan: { select: { articles: { where: { done: true }, select: { minutes: true } } } } },
    });
    const ranked = rows
      .map((p) => ({ user: card(p.user), track: p.track.name, done: p.plan.articles.length, minutes: p.plan.articles.reduce((n, a) => n + a.minutes, 0) }))
      .sort((a, b) => b.done - a.done || b.minutes - a.minutes || a.user.handle.localeCompare(b.user.handle));
    const items: LeaderboardRow[] = ranked.slice(0, 100).map((row, i) => ({ rank: i + 1, ...row }));
    res.set("cache-control", "no-store").json({ items });
  });

  return r;
}
