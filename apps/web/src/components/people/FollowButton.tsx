"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FollowState, Relationship } from "@redart/shared";
import { api, ApiError } from "@/lib/api";
import { useToast } from "../Toast";

/** Follow / Requested / Following, with the right action for each. */
export function FollowButton({ handle, relationship, isPrivate }: { handle: string; relationship: Relationship; isPrivate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<FollowState>(relationship.following);
  const [busy, setBusy] = useState(false);
  if (relationship.self || relationship.blocked) return null;

  async function run(method: "POST" | "DELETE", next: FollowState) {
    setBusy(true);
    const before = state;
    setState(next);
    try {
      const res = await api<{ following: FollowState }>(`/api/users/${handle}/follow`, { method, body: {} });
      setState(res.following);
      if (res.following === "pending") toast(`Request sent. @${handle} will decide.`);
      router.refresh();
    } catch (e) {
      setState(before);
      toast(e instanceof ApiError ? e.message : "Couldn't do that right now.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "accepted") return <button className="btn" type="button" disabled={busy} onClick={() => run("DELETE", "none")} aria-label={`Unfollow @${handle}`}>Following ✓</button>;
  if (state === "pending") return <button className="btn" type="button" disabled={busy} onClick={() => run("DELETE", "none")} aria-label={`Cancel follow request to @${handle}`}>Requested</button>;
  const label = relationship.followsYou === "accepted" ? "Follow back" : isPrivate ? "Ask to follow" : "Follow";
  return <button className="btn solid" type="button" disabled={busy} onClick={() => run("POST", isPrivate ? "pending" : "accepted")}>{label}</button>;
}
