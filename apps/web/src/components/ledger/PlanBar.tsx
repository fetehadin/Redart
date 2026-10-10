"use client";
import Link from "next/link";
import { activePlan, planEnd } from "@redart/shared";
import { fmtDate } from "@/lib/format";
import { useLedgerApi } from "./LedgerContext";
import s from "./Ledger.module.css";

export function PlanBar({ onNewPlan }: { onNewPlan: () => void }) {
  const { state, selectPlan } = useLedgerApi();
  const plans = [...state.plans].sort((a, b) => b.start.localeCompare(a.start));
  const challenge = activePlan(state).challenge;
  return (
    <div className={s.planbar}>
      <label className="lbl" htmlFor="planSel">Plan</label>
      <select id="planSel" value={state.active} onChange={(e) => selectPlan(e.target.value)}>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>{`${p.name}  (${fmtDate(p.start)} – ${fmtDate(planEnd(p))})`}</option>
        ))}
      </select>
      <button className="btn" type="button" onClick={onNewPlan}>New plan</button>
      {challenge ? (
        <span className="hint">Part of <Link href={`/challenges/${challenge.slug}`}>{challenge.title}</Link>{challenge.track ? ` · ${challenge.track.toLowerCase()} pace` : ""}</span>
      ) : null}
    </div>
  );
}
