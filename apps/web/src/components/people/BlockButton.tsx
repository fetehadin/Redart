"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "../Toast";

export function BlockButton({ handle, blocked }: { handle: string; blocked: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const run = async (method: "POST" | "DELETE") => {
    try {
      await api(`/api/users/${handle}/block`, { method, body: {} });
      toast(method === "POST" ? `Blocked @${handle}. Neither of you can see the other now.` : `Unblocked @${handle}.`);
      setConfirming(false);
      router.refresh();
    } catch { toast("Couldn't do that right now."); }
  };
  if (blocked) return <button className="btn ghost" type="button" onClick={() => run("DELETE")}>Unblock</button>;
  if (!confirming) return <button className="btn ghost" type="button" onClick={() => setConfirming(true)}>Block…</button>;
  return (
    <span className="confirm">
      Block @{handle}? You&apos;ll stop following each other.
      <button className="btn danger" type="button" autoFocus onClick={() => run("POST")}>Block</button>
      <button className="btn ghost" type="button" onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}
