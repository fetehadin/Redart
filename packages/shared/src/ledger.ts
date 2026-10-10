// Every change to a ledger is a LedgerOp applied by one pure reducer.
// Guests persist the resulting state locally; members (phase 2) also send the op to the API.

import { addDays, diffDays, type Article, type Favorite, type ISODate, type LedgerState, type Plan, type Theme } from "./core";

export type ArticlePatch = Partial<Omit<Article, "id">>;
export type FavoritePatch = Partial<Omit<Favorite, "id">>;

export type LedgerOp =
  | { type: "plan.create"; plan: Plan; index?: number }
  | { type: "plan.update"; planId: string; name: string; start: ISODate; days: number }
  | { type: "plan.delete"; planId: string }
  | { type: "plan.select"; planId: string }
  | { type: "plan.setDues"; planId: string; dues: Record<string, ISODate> }
  | { type: "article.add"; planId: string; article: Article; index?: number }
  | { type: "article.update"; planId: string; articleId: string; patch: ArticlePatch }
  | { type: "article.remove"; planId: string; articleId: string }
  | { type: "article.move"; planId: string; articleId: string; to: number }
  | { type: "favorite.add"; favorite: Favorite; index?: number }
  | { type: "favorite.update"; favoriteId: string; patch: FavoritePatch }
  | { type: "favorite.remove"; favoriteId: string }
  | { type: "prefs.theme"; theme: Theme }
  | { type: "state.replace"; state: LedgerState };

export const activePlan = (s: LedgerState): Plan => s.plans.find((p) => p.id === s.active) ?? s.plans[0]!;

/** The plan to show after the active one goes away: the one that starts latest. */
const latestPlanId = (plans: Plan[]) => [...plans].sort((a, b) => b.start.localeCompare(a.start))[0]?.id ?? "";

function insertAt<T>(list: T[], item: T, index?: number): T[] {
  const i = index == null ? list.length : Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, i), item, ...list.slice(i)];
}

function mapPlan(s: LedgerState, planId: string, fn: (p: Plan) => Plan): LedgerState {
  let changed = false;
  const plans = s.plans.map((p) => {
    if (p.id !== planId) return p;
    const next = fn(p);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...s, plans } : s;
}

/**
 * Move an article to index `to`. The due dates stay in their slots and the articles shift through them,
 * so moving an article up also moves it earlier in the schedule. Moving to where it already is changes nothing,
 * which makes the op safe to replay.
 */
export function moveKeepingDates<T extends { id: string; due: ISODate }>(list: T[], id: string, to: number): T[] {
  const from = list.findIndex((a) => a.id === id);
  const target = Math.max(0, Math.min(to, list.length - 1));
  if (from < 0 || from === target) return list;
  const moved = [...list];
  const [item] = moved.splice(from, 1);
  moved.splice(target, 0, item!);
  const lo = Math.min(from, target), hi = Math.max(from, target);
  return moved.map((a, i) => (i >= lo && i <= hi && a.due !== list[i]!.due ? { ...a, due: list[i]!.due } : a));
}

/** Apply one operation. Returns the same object when the op refers to something that no longer exists. */
export function applyOp(s: LedgerState, op: LedgerOp): LedgerState {
  switch (op.type) {
    case "plan.create":
      if (s.plans.some((p) => p.id === op.plan.id)) return s;
      return { ...s, plans: insertAt(s.plans, op.plan, op.index), active: op.plan.id };

    case "plan.update":
      return mapPlan(s, op.planId, (p) => {
        // Moving the start carries the due dates with it.
        const shift = diffDays(p.start, op.start);
        const articles = shift ? p.articles.map((a) => ({ ...a, due: addDays(a.due, shift) })) : p.articles;
        return { ...p, name: op.name, start: op.start, days: op.days, articles };
      });

    case "plan.delete": {
      if (s.plans.length <= 1 || !s.plans.some((p) => p.id === op.planId)) return s;
      const plans = s.plans.filter((p) => p.id !== op.planId);
      return { ...s, plans, active: s.active === op.planId ? latestPlanId(plans) : s.active };
    }

    case "plan.select":
      return s.plans.some((p) => p.id === op.planId) && s.active !== op.planId ? { ...s, active: op.planId } : s;

    case "plan.setDues":
      return mapPlan(s, op.planId, (p) => ({
        ...p,
        articles: p.articles.map((a) => (op.dues[a.id] ? { ...a, due: op.dues[a.id]! } : a)),
      }));

    case "article.add":
      return mapPlan(s, op.planId, (p) =>
        p.articles.some((a) => a.id === op.article.id) ? p : { ...p, articles: insertAt(p.articles, op.article, op.index) });

    case "article.update":
      return mapPlan(s, op.planId, (p) => {
        if (!p.articles.some((a) => a.id === op.articleId)) return p;
        return { ...p, articles: p.articles.map((a) => (a.id === op.articleId ? { ...a, ...op.patch } : a)) };
      });

    case "article.remove":
      return mapPlan(s, op.planId, (p) =>
        p.articles.some((a) => a.id === op.articleId) ? { ...p, articles: p.articles.filter((a) => a.id !== op.articleId) } : p);

    case "article.move":
      return mapPlan(s, op.planId, (p) => {
        const articles = moveKeepingDates(p.articles, op.articleId, op.to);
        return articles === p.articles ? p : { ...p, articles };
      });

    case "favorite.add":
      if (s.favorites.some((f) => f.id === op.favorite.id)) return s;
      return { ...s, favorites: insertAt(s.favorites, op.favorite, op.index ?? 0) };

    case "favorite.update":
      if (!s.favorites.some((f) => f.id === op.favoriteId)) return s;
      return { ...s, favorites: s.favorites.map((f) => (f.id === op.favoriteId ? { ...f, ...op.patch } : f)) };

    case "favorite.remove":
      if (!s.favorites.some((f) => f.id === op.favoriteId)) return s;
      return { ...s, favorites: s.favorites.filter((f) => f.id !== op.favoriteId) };

    case "prefs.theme":
      return s.prefs.theme === op.theme ? s : { ...s, prefs: { ...s.prefs, theme: op.theme } };

    case "state.replace":
      return op.state;
  }
}
