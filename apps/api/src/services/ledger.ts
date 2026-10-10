// A member's ledger in Postgres: read it as a LedgerState, change it by applying LedgerOps.
import {
  articleKey, articlesFromRows, diffDays, moveKeepingDates, sanitizeState, STARTER, urlKey, uid,
  type Article, type Favorite, type ISODate, type LedgerOpInput, type LedgerState, type LinkCheck, type Plan,
} from "@redart/shared";
import type { Db, Tx } from "../db";
import { Prisma, type LinkStatus as DbLinkStatus } from "../generated/prisma/client";
import { fromDbDate, toDbDate } from "../lib/dates";
import { HttpError } from "../middleware/errors";

type DbArticle = Prisma.ArticleGetPayload<object>;
type DbFavorite = Prisma.FavoriteGetPayload<object>;

/* ---------- mapping between rows and the shared ledger shapes ---------- */

const toDbLinkStatus = (s: LinkCheck["status"]) => s.toUpperCase() as DbLinkStatus;
const fromDbLinkStatus = (s: DbLinkStatus) => s.toLowerCase() as LinkCheck["status"];

export function articleFromRow(r: DbArticle): Article {
  return {
    id: r.id, title: r.title, url: r.url, topic: r.topic, minutes: r.minutes, minutesAuto: r.minutesAuto,
    due: fromDbDate(r.due), done: r.done, doneAt: r.doneAt ? fromDbDate(r.doneAt) : null, notes: r.notes,
    link: r.linkStatus && r.linkCheckedAt
      ? { status: fromDbLinkStatus(r.linkStatus), httpStatus: r.linkHttpStatus, message: r.linkMessage, checkedAt: r.linkCheckedAt.toISOString() }
      : null,
  };
}

function articleColumns(a: Partial<Omit<Article, "id">>) {
  const d: Prisma.ArticleUncheckedUpdateInput = {};
  if (a.title !== undefined) d.title = a.title.trim();
  if (a.url !== undefined) { d.url = a.url; d.urlKey = urlKey(a.url); }
  if (a.topic !== undefined) d.topic = a.topic.trim();
  if (a.minutes !== undefined) d.minutes = a.minutes;
  if (a.minutesAuto !== undefined) d.minutesAuto = a.minutesAuto;
  if (a.due !== undefined) d.due = toDbDate(a.due);
  if (a.done !== undefined) d.done = a.done;
  if (a.doneAt !== undefined) d.doneAt = a.doneAt ? toDbDate(a.doneAt) : null;
  if (a.notes !== undefined) d.notes = a.notes;
  if (a.link !== undefined) {
    d.linkStatus = a.link ? toDbLinkStatus(a.link.status) : null;
    d.linkHttpStatus = a.link?.httpStatus ?? null;
    d.linkMessage = a.link?.message ?? "";
    d.linkCheckedAt = a.link ? new Date(a.link.checkedAt) : null;
  }
  return d;
}

const newArticleRow = (planId: string, a: Article, position: number): Prisma.ArticleCreateManyInput =>
  ({ ...(articleColumns(a) as Prisma.ArticleCreateManyInput), id: a.id, planId, position });

export function favoriteFromRow(r: DbFavorite): Favorite {
  return { id: r.id, title: r.title, url: r.url, topic: r.topic, minutes: r.minutes, savedAt: fromDbDate(r.savedAt) };
}

const favoriteRow = (userId: string, f: Favorite): Prisma.FavoriteCreateManyInput => ({
  id: f.id, userId, articleKey: articleKey(f), url: f.url, title: f.title.trim(), topic: f.topic.trim(), minutes: f.minutes, savedAt: toDbDate(f.savedAt),
});

/* ---------- reading ---------- */

const STARTER_PLAN_NAME = "Backend & AI reading — 30 days";

/** The member's whole ledger. A member with no plans gets the starter plan, like a new guest. */
export async function loadLedger(db: Db, userId: string, today: ISODate): Promise<LedgerState> {
  let plans = await db.plan.findMany({
    where: { userId }, orderBy: [{ start: "desc" }, { createdAt: "desc" }],
    include: { articles: { orderBy: { position: "asc" } } },
  });
  if (!plans.length) {
    await db.$transaction(async (tx) => {
      // Re-check inside the transaction so two first loads don't both create a plan.
      if (await tx.plan.count({ where: { userId } })) return;
      await insertPlan(tx, userId, { id: uid(), name: STARTER_PLAN_NAME, start: today, days: 30, articles: articlesFromRows(STARTER, today, 30).map((a) => ({ ...a, minutesAuto: true })) });
    });
    plans = await db.plan.findMany({ where: { userId }, orderBy: { start: "desc" }, include: { articles: { orderBy: { position: "asc" } } } });
  }
  const [user, favorites] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { activePlanId: true } }),
    db.favorite.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  const shaped: Plan[] = plans.map((p) => ({ id: p.id, name: p.name, start: fromDbDate(p.start), days: p.days, articles: p.articles.map(articleFromRow) }));
  const active = shaped.some((p) => p.id === user.activePlanId) ? user.activePlanId! : shaped[0]!.id;
  return { version: 2, active, plans: shaped, favorites: favorites.map(favoriteFromRow), prefs: { theme: "system" } };
}

/* ---------- writing ---------- */

async function insertPlan(tx: Tx, userId: string, p: Plan, makeActive = true) {
  await tx.plan.create({ data: { id: p.id, userId, name: p.name.trim(), start: toDbDate(p.start), days: p.days } });
  if (p.articles.length) await tx.article.createMany({ data: p.articles.map((a, i) => newArticleRow(p.id, a, i)) });
  if (makeActive) await tx.user.update({ where: { id: userId }, data: { activePlanId: p.id } });
}

async function ownedPlan(tx: Tx, userId: string, planId: string) {
  const p = await tx.plan.findFirst({ where: { id: planId, userId } });
  if (!p) throw new HttpError(404, "NOT_FOUND", "That plan doesn't exist anymore.");
  return p;
}

async function orderedIds(tx: Tx, planId: string): Promise<string[]> {
  const rows = await tx.article.findMany({ where: { planId }, orderBy: { position: "asc" }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Store the given order as positions 0..n-1 in one statement. */
async function renumber(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE "Article" AS a SET "position" = v.pos
    FROM unnest(${ids}::uuid[], ${ids.map((_, i) => i)}::int[]) AS v(id, pos)
    WHERE a.id = v.id`;
}

function rethrowConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    throw new HttpError(409, "CONFLICT", "That item already exists. Reload to see the latest version.");
  throw e;
}

async function applyOne(tx: Tx, userId: string, op: LedgerOpInput, today: ISODate): Promise<void> {
  switch (op.type) {
    case "plan.create": {
      if (await tx.plan.findUnique({ where: { id: op.plan.id }, select: { id: true } })) return; // replayed op
      await insertPlan(tx, userId, op.plan).catch(rethrowConflict);
      return;
    }
    case "plan.update": {
      const p = await ownedPlan(tx, userId, op.planId);
      const shift = diffDays(fromDbDate(p.start), op.start);
      await tx.plan.update({ where: { id: p.id }, data: { name: op.name.trim(), start: toDbDate(op.start), days: op.days } });
      // Moving the start carries the due dates with it.
      if (shift) await tx.$executeRaw`UPDATE "Article" SET "due" = "due" + ${shift}::int WHERE "planId" = ${p.id}::uuid`;
      return;
    }
    case "plan.delete": {
      const count = await tx.plan.count({ where: { userId } });
      const p = await tx.plan.findFirst({ where: { id: op.planId, userId } });
      if (!p || count <= 1) return; // the last plan can't be deleted
      await tx.plan.delete({ where: { id: p.id } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { activePlanId: true } });
      if (user.activePlanId === p.id) {
        const latest = await tx.plan.findFirst({ where: { userId }, orderBy: { start: "desc" }, select: { id: true } });
        await tx.user.update({ where: { id: userId }, data: { activePlanId: latest?.id ?? null } });
      }
      return;
    }
    case "plan.select": {
      await ownedPlan(tx, userId, op.planId);
      await tx.user.update({ where: { id: userId }, data: { activePlanId: op.planId } });
      return;
    }
    case "plan.setDues": {
      await ownedPlan(tx, userId, op.planId);
      const entries = Object.entries(op.dues);
      if (!entries.length) return;
      await tx.$executeRaw`
        UPDATE "Article" AS a SET "due" = v.due
        FROM unnest(${entries.map(([id]) => id)}::uuid[], ${entries.map(([, d]) => d)}::date[]) AS v(id, due)
        WHERE a.id = v.id AND a."planId" = ${op.planId}::uuid`;
      return;
    }
    case "article.add": {
      await ownedPlan(tx, userId, op.planId);
      if (await tx.article.findUnique({ where: { id: op.article.id }, select: { id: true } })) return; // replayed op
      const ids = await orderedIds(tx, op.planId);
      const at = op.index == null ? ids.length : Math.min(op.index, ids.length);
      await tx.article.create({ data: newArticleRow(op.planId, op.article, ids.length) }).catch(rethrowConflict);
      if (at < ids.length) { ids.splice(at, 0, op.article.id); await renumber(tx, ids); }
      return;
    }
    case "article.update": {
      await ownedPlan(tx, userId, op.planId);
      const r = await tx.article.updateMany({ where: { id: op.articleId, planId: op.planId }, data: articleColumns(op.patch) as Prisma.ArticleUncheckedUpdateManyInput });
      if (!r.count) throw new HttpError(404, "NOT_FOUND", "That article doesn't exist anymore.");
      return;
    }
    case "article.remove": {
      await ownedPlan(tx, userId, op.planId);
      await tx.article.deleteMany({ where: { id: op.articleId, planId: op.planId } });
      return;
    }
    case "article.move": {
      await ownedPlan(tx, userId, op.planId);
      const rows = await tx.article.findMany({ where: { planId: op.planId }, orderBy: { position: "asc" }, select: { id: true, due: true } });
      const shaped = rows.map((r) => ({ id: r.id, due: fromDbDate(r.due) }));
      const moved = moveKeepingDates(shaped, op.articleId, op.to);
      if (moved === shaped) return;
      await renumber(tx, moved.map((a) => a.id));
      const changed = moved.filter((a, i) => a.due !== shaped[i]!.due || a.id !== shaped[i]!.id);
      await tx.$executeRaw`
        UPDATE "Article" AS a SET "due" = v.due
        FROM unnest(${changed.map((a) => a.id)}::uuid[], ${changed.map((a) => a.due)}::date[]) AS v(id, due)
        WHERE a.id = v.id`;
      return;
    }
    case "favorite.add": {
      const key = articleKey(op.favorite);
      const exists = await tx.favorite.findFirst({ where: { OR: [{ id: op.favorite.id }, { userId, articleKey: key }] }, select: { id: true, userId: true } });
      if (exists) { if (exists.userId !== userId) throw new HttpError(409, "CONFLICT", "That favourite already exists."); return; }
      await tx.favorite.create({ data: favoriteRow(userId, op.favorite) }).catch(rethrowConflict);
      return;
    }
    case "favorite.update": {
      const f = await tx.favorite.findFirst({ where: { id: op.favoriteId, userId } });
      if (!f) return;
      const merged = { ...favoriteFromRow(f), ...op.patch };
      await tx.favorite.update({ where: { id: f.id }, data: { ...favoriteRow(userId, merged), id: undefined, userId: undefined } }).catch(rethrowConflict);
      return;
    }
    case "favorite.remove": {
      await tx.favorite.deleteMany({ where: { id: op.favoriteId, userId } });
      return;
    }
    case "prefs.theme":
      return; // the theme lives in the browser
    case "state.replace": {
      const state = sanitizeState(op.state, today);
      if (!state) throw new HttpError(400, "VALIDATION", "That isn't a Redart backup.");
      await tx.plan.deleteMany({ where: { userId } });
      await tx.favorite.deleteMany({ where: { userId } });
      const fresh = withFreshIds(state);
      for (const p of fresh.plans) await insertPlan(tx, userId, p, p.id === fresh.active);
      await tx.favorite.createMany({ data: dedupeFavorites(fresh.favorites).map((f) => favoriteRow(userId, f)) });
      return;
    }
  }
}

export interface ApplyResult { reload: boolean }

/** Apply ops in order, all or nothing. `reload` tells the client to fetch the ledger again (ids were reassigned). */
export async function applyOps(db: Db, userId: string, ops: LedgerOpInput[], today: ISODate): Promise<ApplyResult> {
  await db.$transaction(async (tx) => {
    for (const op of ops) await applyOne(tx, userId, op, today);
  }, { timeout: 15_000 });
  return { reload: ops.some((o) => o.type === "state.replace") };
}

/* ---------- importing a guest ledger ---------- */

/** Backups may carry old-style or foreign ids; give every plan, article and favourite a new one. */
function withFreshIds(s: LedgerState): LedgerState {
  const planIds = new Map<string, string>();
  const plans = s.plans.map((p) => {
    const id = uid();
    planIds.set(p.id, id);
    return { ...p, id, articles: p.articles.map((a) => ({ ...a, id: uid() })) };
  });
  return { ...s, active: planIds.get(s.active) ?? plans[0]!.id, plans, favorites: s.favorites.map((f) => ({ ...f, id: uid() })) };
}

function dedupeFavorites(list: Favorite[]): Favorite[] {
  const seen = new Set<string>();
  return list.filter((f) => { const k = articleKey(f); if (seen.has(k)) return false; seen.add(k); return true; });
}

export interface ImportSummary { plansCreated: number; plansMerged: number; articlesAdded: number; favoritesAdded: number }

/**
 * Merge a guest's local ledger into the account without overwriting anything.
 * A plan with the same name and start date is merged (new articles appended by articleKey); others are created.
 * Running it twice adds nothing the second time.
 */
export async function importLedger(db: Db, userId: string, raw: unknown, today: ISODate): Promise<ImportSummary> {
  const parsed = sanitizeState(raw, today);
  if (!parsed) throw new HttpError(400, "VALIDATION", "There's no readable ledger to import.");
  const incoming = withFreshIds(parsed);
  const summary: ImportSummary = { plansCreated: 0, plansMerged: 0, articlesAdded: 0, favoritesAdded: 0 };

  await db.$transaction(async (tx) => {
    const existing = await tx.plan.findMany({ where: { userId }, include: { articles: { select: { url: true, title: true, position: true } } } });
    for (const p of incoming.plans) {
      const match = existing.find((e) => e.name.toLowerCase() === p.name.toLowerCase() && fromDbDate(e.start) === p.start);
      if (!match) {
        await insertPlan(tx, userId, p, false);
        summary.plansCreated++;
        summary.articlesAdded += p.articles.length;
        continue;
      }
      const have = new Set(match.articles.map(articleKey));
      const extra = p.articles.filter((a) => !have.has(articleKey(a)));
      const base = match.articles.reduce((m, a) => Math.max(m, a.position + 1), 0);
      if (extra.length) await tx.article.createMany({ data: extra.map((a, i) => newArticleRow(match.id, a, base + i)) });
      summary.plansMerged++;
      summary.articlesAdded += extra.length;
    }
    const haveFav = new Set((await tx.favorite.findMany({ where: { userId }, select: { articleKey: true } })).map((f) => f.articleKey));
    const newFavs = dedupeFavorites(incoming.favorites).filter((f) => !haveFav.has(articleKey(f)));
    if (newFavs.length) await tx.favorite.createMany({ data: newFavs.map((f) => favoriteRow(userId, f)) });
    summary.favoritesAdded = newFavs.length;
  }, { timeout: 30_000 });
  return summary;
}
