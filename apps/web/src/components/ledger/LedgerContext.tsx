"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  activePlan, articleKey, articlesFromRows, diffDays, favoriteFromArticle, LIMITS, newArticle, nextDueDate, planEnd, planStats,
  sanitizeState, spread, STARTER, todayISO, uid,
  type Article, type Favorite, type ImportResult, type ISODate, type LedgerState, type Me, type Plan,
} from "@redart/shared";
import { useLedger } from "@/lib/hooks/useLedger";
import { useLinkChecker } from "@/lib/hooks/useLinkChecker";
import { useToday } from "@/lib/hooks/useEnvironment";
import { LEDGER_KEY, LocalStore } from "@/lib/store/local";
import { RemoteStore } from "@/lib/store/remote";
import { api, ApiError } from "@/lib/api";
import type { StoreProblem } from "@/lib/store/types";
import { fmtDate, plural, short } from "@/lib/format";
import { linkChecksUnavailable } from "@/lib/inspect";
import { useToast } from "../Toast";

export type PlanSeed = "empty" | "carry" | "favorites" | "starter";

export interface GuestLedgerSummary { plans: number; articles: number }

export interface LedgerApi {
  /** The signed-in member, or null for a guest whose ledger lives in this browser. */
  member: Me | null;
  /** A guest ledger on this device that a member hasn't brought into their account yet. */
  guestLedger: GuestLedgerSummary | null;
  importGuestLedger(): Promise<void>;
  dismissGuestLedger(): void;
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

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; } // blocked by the browser
}

const importDoneKey = (userId: string) => `redart:imported:${userId}`;

/** The guest ledger saved on this device, if it holds anything worth importing. */
export function readGuestLedger(): { raw: unknown; summary: GuestLedgerSummary } | null {
  try {
    const raw = JSON.parse(browserStorage()?.getItem(LEDGER_KEY) ?? "null");
    const s = sanitizeState(raw, todayISO());
    if (!s) return null;
    const articles = s.plans.reduce((n, p) => n + p.articles.length, 0);
    return articles || s.favorites.length ? { raw, summary: { plans: s.plans.length, articles } } : null;
  } catch { return null; }
}

/** Bring this device's guest ledger into the signed-in account. Safe to run twice. */
export async function importGuestLedgerNow(userId: string): Promise<ImportResult | null> {
  const guest = readGuestLedger();
  if (!guest) return null;
  const result = await api<ImportResult>(`/api/me/import?today=${todayISO()}`, { body: { state: guest.raw } });
  try { browserStorage()?.setItem(importDoneKey(userId), new Date().toISOString()); } catch { /* ignore */ }
  return result;
}

interface ProviderProps { member: Me | null; children: ReactNode; fallback: ReactNode }

/** Loads the ledger and provides every action the ledger UI needs. Renders `fallback` until loaded. */
export function LedgerProvider({ member, children, fallback }: ProviderProps) {
  const memberId = member?.id ?? null;
  const makeStore = useCallback(
    () => (memberId ? new RemoteStore(memberId, browserStorage()) : new LocalStore(browserStorage(), window)),
    [memberId],
  );
  const { state, current, dispatch, problem, loadError, retry, store } = useLedger(makeStore);
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

  // Offer to import a guest ledger left on this device, once per member.
  const [guestLedger, setGuestLedger] = useState<GuestLedgerSummary | null>(null);
  useEffect(() => {
    if (!memberId) return;
    let done = false;
    try { done = !!browserStorage()?.getItem(importDoneKey(memberId)); } catch { /* ignore */ }
    // Reading localStorage can only happen after mount, so this effect is where the offer appears.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!done) setGuestLedger(readGuestLedger()?.summary ?? null);
  }, [memberId]);

  const importGuestLedger = useCallback(async () => {
    if (!memberId) return;
    try {
      const r = await importGuestLedgerNow(memberId);
      setGuestLedger(null);
      await (store() as RemoteStore | null)?.reload?.();
      if (r) toast(`Added ${plural(r.articlesAdded, "article")}${r.plansCreated ? ` in ${plural(r.plansCreated, "new plan")}` : ""}${r.favoritesAdded ? ` and ${plural(r.favoritesAdded, "favourite")}` : ""} to your account.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't import right now. Try again in a moment.");
    }
  }, [memberId, store, toast]);

  const dismissGuestLedger = useCallback(() => {
    if (memberId) try { browserStorage()?.setItem(importDoneKey(memberId), "dismissed"); } catch { /* ignore */ }
    setGuestLedger(null);
  }, [memberId]);

  const plan = state ? activePlan(state) : null;
  const favKeys = useMemo(() => new Set(state?.favorites.map(articleKey) ?? []), [state?.favorites]);

  /** Run against the latest state, so callbacks never act on a stale render. */
  const withState = useCallback(<T,>(fn: (s: LedgerState, p: Plan) => T): T | undefined => {
    const s = current();
    return s ? fn(s, activePlan(s)) : undefined;
  }, [current]);

  const value = useMemo((): LedgerApi | null => {
    if (!state || !plan) return null;
    return {
      member, guestLedger, importGuestLedger, dismissGuestLedger,
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

      move: (index, delta) => withState((_s, p) => {
        const a = p.articles[index];
        if (a) dispatch({ type: "article.move", planId: p.id, articleId: a.id, to: index + delta });
      }),

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
  }, [member, guestLedger, importGuestLedger, dismissGuestLedger, state, plan, today, problem, checking, favKeys, dispatch, withState, current, toast, queueCheck, checkPlanOnce]);

  // The callbacks inside `value` read refs only when called from event handlers, never during render.
  if (loadError) {
    return (
      <div className="quiet" role="alert">
        <p>{loadError}</p>
        <button className="btn" type="button" onClick={retry}>Try again</button>
      </div>
    );
  }
  // eslint-disable-next-line react-hooks/refs
  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
