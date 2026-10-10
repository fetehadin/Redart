"use client";
import { useState } from "react";
import { todayISO, type ArticleRef, type QuickAddResult } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { useToast } from "../Toast";

/** Put an article from someone else into your current plan, scheduled after your last one. */
export function AddToPlanButton({ article }: { article: ArticleRef }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "busy" | "added">("idle");
  if (state === "added") return <span className="hint">In your plan ✓</span>;
  return (
    <button className="btn" type="button" disabled={state === "busy"} onClick={async () => {
      setState("busy");
      try {
        const r = await api<QuickAddResult>(`/api/ledger/quick-add?today=${todayISO()}`, {
          body: { url: article.url, title: article.title, minutes: article.minutes, topic: article.topic || undefined },
        });
        setState("added");
        toast(r.duplicate ? `It's already in ${r.planName}.` : `Added to ${r.planName}, due ${shortDate(r.due)}.`);
      } catch (e) {
        setState("idle");
        toast(e instanceof ApiError ? e.message : "Couldn't add it right now.");
      }
    }}>Add to my plan</button>
  );
}
