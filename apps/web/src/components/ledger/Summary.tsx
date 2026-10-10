"use client";
import { planStats } from "@redart/shared";
import { fmtDate, plural, short } from "@/lib/format";
import { cx } from "@/lib/cx";
import { useLedgerApi } from "./LedgerContext";
import s from "./Ledger.module.css";

function Stat({ k, v, sub, className }: { k: string; v: string; sub?: string | null; className?: string }) {
  return (
    <div className={s.stat}>
      <div className={s.k}>{k}</div>
      <div className={cx(s.v, className)}>{v}</div>
      {sub ? <div className={s.s}>{sub}</div> : null}
    </div>
  );
}

export function Summary() {
  const { plan: p, today } = useLedgerApi();
  const st = planStats(p, today);
  let dayLabel: string, daySub: string;
  if (st.phase === "before") { dayLabel = "Starts " + fmtDate(p.start); daySub = "in " + plural(1 - st.dayNo, "day"); }
  else if (st.phase === "after") { dayLabel = "Finished"; daySub = "ended " + fmtDate(st.end, true); }
  else { dayLabel = `Day ${st.dayNo} of ${p.days}`; daySub = `${plural(p.days - st.dayNo, "day")} left · ends ${fmtDate(st.end)}`; }
  const showMarker = st.total > 0 && st.expected > 0 && st.done < st.total;

  return (
    <section className={s.summary} aria-live="polite" aria-label="Plan progress">
      <Stat k="Articles read" v={`${st.done} / ${st.total}`} sub={st.total ? Math.round((st.done * 100) / st.total) + "% complete" : "nothing on the list yet"} />
      <Stat k="Reading time" v={`${st.minutesDone} / ${st.minutesAll} min`} sub={`${st.minutesAll - st.minutesDone} min still to read`} />
      <Stat k="Timeline" v={dayLabel} sub={daySub} />
      <Stat
        k="Pace"
        v={st.pace.text}
        sub={st.next ? `Next: ${short(st.next.title, 60)} (${fmtDate(st.next.due)})` : null}
        className={cx(s.small, st.pace.key === "behind" ? "behind" : st.pace.key === "ok" && "ok")}
      />
      <div className={s.bar} role="progressbar" aria-label="Articles read" aria-valuemin={0} aria-valuemax={st.total || 1} aria-valuenow={st.done}>
        <i style={{ width: `${st.total ? (st.done * 100) / st.total : 0}%` }} />
        {showMarker && <b title="Where you should be today" style={{ left: `calc(${(Math.min(st.expected, st.total) * 100) / st.total}% - 1px)` }} />}
      </div>
    </section>
  );
}
