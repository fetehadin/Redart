"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  activePlan, articleKey, articlesFromRows, diffDays, favoriteFromArticle, LIMITS, newArticle, nextDueDate, planEnd, planStats,
  spread, STARTER, uid, type Article, type Favorite, type ISODate, type LedgerState, type Plan,
} from "@redart/shared";
import { useLedger } from "@/lib/hooks/useLedger";
import { useLinkChecker } from "@/lib/hooks/useLinkChecker";
import { useToday } from "@/lib/hooks/useEnvironment";
import { LocalStore } from "@/lib/store/local";
import type { StoreProblem } from "@/lib/store/types";
import { fmtDate, plural, short } from "@/lib/format";
import { linkChecksUnavailable } from "@/lib/inspect";
import { useToast } from "../Toast";

export type PlanSeed = "empty" | "carry" | "favorites" | "starter";

export interface LedgerApi {
  state: LedgerState;
  plan: Plan;
  today: ISODate;
  problem: StoreProblem | null;
  checking: ReadonlySet<string>;
  favKeys: ReadonlySet<string>;
  selectPlan(id: string): void;
  createPlan(input: { name: string; start: ISODate; days: number; seed: PlanSeed }): void;
  updatePlan(input: { name: string; start: ISODate; days: number }): void;
  deletePlan(): void;
  addArticle(input: { title: string; url: string; topic: string; minutes: number; minutesAuto: boolean; due: ISODate }): void;
  saveArticle(a: Article, fields: { title: string; url: string; topic: string; minutes: number }): void;
  setNotes(id: string, notes: string): void;
  setDue(id: string, due: ISODate): void;
  toggleDone(id: string, on: boolean): void;
  toggleFav(item: Pick<Article, "title" | "url" | "topic" | "minutes">): void;
  addFavToPlan(f: Favorite): void;
  move(index: number, delta: -1 | 1): void;
  removeArticle(id: string): void;
  spreadDates(): void;
  recheck(id: string): void;
  checkAll(): void;
  restore(next: LedgerState): void;
}

const Ctx = createContext<LedgerApi | null>(null);
export function useLedgerApi(): LedgerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLedgerApi must be used inside <LedgerProvider>");
  return v;
}

function guestStore() {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* blocked by the browser */ }
  return new LocalStore(storage, window);
}

/** Loads the ledger and provides every action the ledger UI needs. Renders `fallback` until loaded. */
export function LedgerProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { state, current, dispatch, problem } = useLedger(guestStore);
  const today = useToday();
  const toast = useToast();
  const { checking, queueCheck, checkStale } = useLinkChecker(current, dispatch);

  // Check stale links once the ledger loads and whenever another plan is opened.
  const activeId = state?.active;
  const checkedPlans = useRef(new Set<string>());
  const checkPlanOnce = useCallback((id: string, reset = false) => {
    if (reset) checkedPlans.current.clear();
    if (checkedPlans.current.has(id)) return;
    checkedPlans.current.add(id);
    checkStale(id);
  }, [checkStale]);
  useEffect(() => { if (activeId) checkPlanOnce(activeId); }, [activeId, checkPlanOnce]);

  const plan = state ? activePlan(state) : null;
  const favKeys = useMemo(() => new Set(state?.favorites.map(articleKey) ?? []), [state?.favorites]);

  /** Run against the latest state, so callbacks never act on a stale render. */
  const withState = useCallback(<T,>(fn: (s: LedgerState, p: Plan) => T): T | undefined => {
    const s = current();
    return s ? fn(s, activePlan(s)) : undefined;
  }, [current]);

  const api = useMemo((): LedgerApi | null => {
    if (!state || !plan) return null;
    return {
      state, plan, today, problem, checking, favKeys,

      selectPlan: (id) => dispatch({ type: "plan.select", planId: id }),

      createPlan: ({ name, start, days, seed }) => withState((s, p) => {
        let articles: Article[] = [];
        let note = "";
        if (seed === "starter") articles = articlesFromRows(STARTER, start, days).map((a) => ({ ...a, minutesAuto: true }));
        if (seed === "carry") {
          articles = spread(p.articles.filter((a) => !a.done).map((a) => ({ ...a, id: uid(), done: false, doneAt: null })), start, days);
          if (!articles.length) note = " The current plan had no unread articles, so it starts empty.";
        }
        if (seed === "favorites") {
          articles = spread(s.favorites.map((f) => newArticle(f, start)), start, days);
          if (!articles.length) note = " You have no favourites yet, so it starts empty.";
        }
        const created: Plan = { id: uid(), name: name.slice(0, LIMITS.planName), start, days, articles };
        dispatch({ type: "plan.create", plan: created });
        checkPlanOnce(created.id);
        toast(`Plan “${short(name)}” created.${note}`);
      }),

      updatePlan: ({ name, start, days }) => withState((s, p) => {
        const shift = diffDays(p.start, start);
        dispatch({ type: "plan.update", planId: p.id, name: name.slice(0, LIMITS.planName), start, days });
        const after = activePlan(current() ?? s);
        const outside = after.articles.filter((a) => a.due > planEnd(after)).length;
        toast((shift ? `Saved. Due dates moved ${plural(Math.abs(shift), "day")} ${shift > 0 ? "later" : "earlier"}.` : "Settings saved.") +
          (outside ? ` ${plural(outside, "article")} now fall after the plan ends; use “Spread dates” to fit them in.` : ""));
      }),

      deletePlan: () => withState((s, p) => {
        if (s.plans.length <= 1) return;
        const index = s.plans.indexOf(p);
        dispatch({ type: "plan.delete", planId: p.id });
        toast(`Deleted “${short(p.name)}”`, () => dispatch({ type: "plan.create", plan: p, index }));
      }),

      addArticle: (input) => withState((_s, p) => {
        const a = newArticle(input, p.start);
        dispatch({ type: "article.add", planId: p.id, article: a });
        toast(a.due < p.start || a.due > planEnd(p) ? "Added. Its due date is outside this plan's dates." : `Added “${short(a.title)}”, due ${fmtDate(a.due)}`);
        if (a.url) queueCheck(p.id, a.id);
      }),

      saveArticle: (a, fields) => withState((s, p) => {
        const fav = s.favorites.find((f) => articleKey(f) === articleKey(a));
        const linkChanged = fields.url !== a.url;
        const minutesChanged = fields.minutes !== a.minutes;
        const patch: Partial<Article> = { title: fields.title.slice(0, LIMITS.title), url: fields.url, topic: fields.topic.slice(0, LIMITS.topic) };
        if (minutesChanged) { patch.minutes = fields.minutes; patch.minutesAuto = false; }
        if (linkChanged) { patch.link = null; if (!minutesChanged) patch.minutesAuto = true; }
        dispatch({ type: "article.update", planId: p.id, articleId: a.id, patch });
        if (fav) dispatch({ type: "favorite.update", favoriteId: fav.id, patch: { title: patch.title, url: patch.url, topic: patch.topic, minutes: fields.minutes } });
        if (linkChanged && fields.url) queueCheck(p.id, a.id, true);
      }),

      setNotes: (id, notes) => withState((_s, p) =>
        dispatch({ type: "article.update", planId: p.id, articleId: id, patch: { notes: notes.slice(0, LIMITS.notes) } })),

      setDue: (id, due) => withState((_s, p) => dispatch({ type: "article.update", planId: p.id, articleId: id, patch: { due } })),

      toggleDone: (id, on) => withState((s, p) => {
        dispatch({ type: "article.update", planId: p.id, articleId: id, patch: { done: on, doneAt: on ? today : null } });
        const st = planStats(activePlan(current() ?? s), today);
        if (on && st.done === st.total) toast(`Plan complete: ${st.total} articles, ${st.minutesAll} minutes of reading. Well done.`);
      }),

      toggleFav: (item) => withState((s) => {
        const k = articleKey(item);
        const index = s.favorites.findIndex((f) => articleKey(f) === k);
        if (index >= 0) {
          const gone = s.favorites[index]!;
          dispatch({ type: "favorite.remove", favoriteId: gone.id });
          toast("Removed from favourites", () => dispatch({ type: "favorite.add", favorite: gone, index }));
        } else {
          dispatch({ type: "favorite.add", favorite: favoriteFromArticle(item, today) });
          toast("Saved to favourites. Find it under ★ Favourites, in any plan.");
        }
      }),

      addFavToPlan: (f) => withState((_s, p) => {
        if (p.articles.some((a) => articleKey(a) === articleKey(f))) return;
        const a = newArticle({ ...f, due: nextDueDate(p, today) }, p.start);
        dispatch({ type: "article.add", planId: p.id, article: a });
        toast(`Added “${short(f.title)}” to ${p.name}, due ${fmtDate(a.due)}`);
        if (a.url) queueCheck(p.id, a.id);
      }),

      move: (index, delta) => withState((_s, p) => dispatch({ type: "article.swap", planId: p.id, from: index, to: index + delta })),

      removeArticle: (id) => withState((_s, p) => {
        const index = p.articles.findIndex((a) => a.id === id);
        const gone = p.articles[index];
        if (!gone) return;
        dispatch({ type: "article.remove", planId: p.id, articleId: id });
        toast(`Removed “${short(gone.title)}”`, () => dispatch({ type: "article.add", planId: p.id, article: gone, index }));
      }),

      spreadDates: () => withState((_s, p) => {
        if (!p.articles.length) return;
        const before = Object.fromEntries(p.articles.map((a) => [a.id, a.due]));
        const spaced = spread(p.articles.map((a) => ({ id: a.id, due: a.due })), p.start, p.days);
        dispatch({ type: "plan.setDues", planId: p.id, dues: Object.fromEntries(spaced.map((a) => [a.id, a.due])) });
        toast(`Due dates spread across ${plural(p.days, "day")}`, () => dispatch({ type: "plan.setDues", planId: p.id, dues: before }));
      }),

      recheck: (id) => withState((_s, p) => queueCheck(p.id, id, true)),

      checkAll: () => withState((_s, p) => {
        if (!navigator.onLine) { toast("You're offline. Try again when you reconnect."); return; }
        if (linkChecksUnavailable()) { toast("Link checks aren't available right now."); return; }
        const withLinks = p.articles.filter((a) => a.url);
        if (!withLinks.length) { toast("No links to check in this plan."); return; }
        withLinks.forEach((a) => queueCheck(p.id, a.id, true));
        toast(`Checking ${plural(withLinks.length, "link")}…`);
      }),

      restore: (next) => withState((s) => {
        dispatch({ type: "state.replace", state: next });
        checkPlanOnce(next.active, true);
        toast("Backup restored", () => dispatch({ type: "state.replace", state: s }));
      }),
    };
  }, [state, plan, today, problem, checking, favKeys, dispatch, withState, current, toast, queueCheck, checkPlanOnce]);

  // The callbacks inside `api` read refs only when called from event handlers, never during render.
  // eslint-disable-next-line react-hooks/refs
  if (!api) return <>{fallback}</>;
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
