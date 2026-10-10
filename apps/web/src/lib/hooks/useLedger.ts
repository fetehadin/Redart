"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyOp, todayISO, type LedgerOp, type LedgerState } from "@redart/shared";
import type { LedgerStore, StoreProblem } from "../store/types";

export interface Ledger {
  state: LedgerState | null;
  /** Set when the ledger couldn't be loaded at all. */
  loadError: string | null;
  retry: () => void;
  /** Always the latest state, for async callbacks that outlive a render. */
  current: () => LedgerState | null;
  dispatch: (op: LedgerOp) => void;
  problem: StoreProblem | null;
  store: () => LedgerStore | null;
}

/** `makeStore` runs in the browser only (stores need window and storage); a new function means a new store. */
export function useLedger(makeStore: () => LedgerStore): Ledger {
  const [state, setState] = useState<LedgerState | null>(null);
  const [problem, setProblem] = useState<StoreProblem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<LedgerState | null>(null);
  const storeRef = useRef<LedgerStore | null>(null);

  useEffect(() => {
    let alive = true;
    const store = makeStore();
    storeRef.current = store;
    const show = (s: LedgerState) => { ref.current = s; setState(s); };
    const offProblem = store.onProblem(setProblem);
    store.load(todayISO()).then(
      (s) => { if (alive) { setLoadError(null); show(s); } },
      (e: unknown) => { if (alive) setLoadError(e instanceof Error ? e.message : "Couldn't load your ledger."); },
    );
    const offSync = store.subscribe(show);
    const flush = () => store.flush();
    const onHide = () => { if (document.hidden) flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive = false;
      offProblem(); offSync();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      store.flush();
      (store as { dispose?: () => void }).dispose?.();
    };
  }, [makeStore, attempt]);

  const dispatch = useCallback((op: LedgerOp) => {
    const prev = ref.current;
    if (!prev) return;
    const next = applyOp(prev, op);
    if (next === prev) return;
    ref.current = next;
    setState(next);
    storeRef.current?.commit(op, next);
  }, []);

  const current = useCallback(() => ref.current, []);
  const store = useCallback(() => storeRef.current, []);
  const retry = useCallback(() => { setLoadError(null); setAttempt((n) => n + 1); }, []);
  return { state, loadError, retry, current, dispatch, problem, store };
}
