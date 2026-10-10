"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyOp, todayISO, type LedgerOp, type LedgerState } from "@redart/shared";
import type { LedgerStore, StoreProblem } from "../store/types";

export interface Ledger {
  state: LedgerState | null;
  /** Always the latest state, for async callbacks that outlive a render. */
  current: () => LedgerState | null;
  dispatch: (op: LedgerOp) => void;
  problem: StoreProblem | null;
}

/** `makeStore` runs once, in the browser only (stores need window and localStorage). */
export function useLedger(makeStore: () => LedgerStore): Ledger {
  const [state, setState] = useState<LedgerState | null>(null);
  const [problem, setProblem] = useState<StoreProblem | null>(null);
  const ref = useRef<LedgerState | null>(null);
  const storeRef = useRef<LedgerStore | null>(null);

  useEffect(() => {
    let alive = true;
    const store = (storeRef.current ??= makeStore());
    const offProblem = store.onProblem(setProblem);
    store.load(todayISO()).then((s) => { if (alive) { ref.current = s; setState(s); } });
    const offSync = store.subscribe((s) => { ref.current = s; setState(s); });
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
    };
  }, [makeStore]);

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
  return { state, current, dispatch, problem };
}
