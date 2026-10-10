"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clampInt, LIMITS, linkIsStale, sanitizeLink, type LedgerOp, type LedgerState } from "@redart/shared";
import { inspectUrl, linkChecksUnavailable } from "../inspect";

const CONCURRENCY = 2;
interface Job { planId: string; articleId: string; force: boolean }

/** Background link checks for ledger rows, two at a time. */
export function useLinkChecker(current: () => LedgerState | null, dispatch: (op: LedgerOp) => void) {
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const queue = useRef<Job[]>([]);
  const running = useRef(new Set<string>());

  const pump = useCallback(() => {
    const step = () => {
      while (running.current.size < CONCURRENCY && queue.current.length) {
        const job = queue.current.shift()!;
        const a = current()?.plans.find((p) => p.id === job.planId)?.articles.find((x) => x.id === job.articleId);
        if (!a?.url) continue;
        const urlAtStart = a.url;
        running.current.add(a.id);
        setChecking(new Set(running.current));
        inspectUrl(a.url, job.force).then((r) => {
          running.current.delete(job.articleId);
          setChecking(new Set(running.current));
          // The article may have been removed or its link edited while we waited.
          const now = current()?.plans.find((p) => p.id === job.planId)?.articles.find((x) => x.id === job.articleId);
          const link = sanitizeLink(r);
          if (now && now.url === urlAtStart && link) {
            const minutes = r.status === "ok" && Number.isInteger(r.minutes) && now.minutesAuto
              ? clampInt(r.minutes, LIMITS.minMinutes, LIMITS.maxMinutes, now.minutes) : now.minutes;
            dispatch({ type: "article.update", planId: job.planId, articleId: job.articleId, patch: { link, minutes } });
          }
          step();
        });
      }
    };
    step();
  }, [current, dispatch]);

  const queueCheck = useCallback((planId: string, articleId: string, force = false) => {
    if (running.current.has(articleId) || queue.current.some((q) => q.articleId === articleId)) return;
    queue.current.push({ planId, articleId, force });
    pump();
  }, [pump]);

  /** Check every link in the plan that was never checked or is over a week old. */
  const checkStale = useCallback((planId: string) => {
    if (!navigator.onLine || linkChecksUnavailable()) return;
    const p = current()?.plans.find((x) => x.id === planId);
    const now = Date.now();
    p?.articles.filter((a) => linkIsStale(a, now)).forEach((a) => queueCheck(p.id, a.id));
  }, [current, queueCheck]);

  useEffect(() => {
    const onOnline = () => { const s = current(); if (s) checkStale(s.active); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [current, checkStale]);

  return { checking, queueCheck, checkStale };
}
