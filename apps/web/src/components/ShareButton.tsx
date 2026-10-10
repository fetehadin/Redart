"use client";
import { useToast } from "./Toast";

export function ShareButton() {
  const toast = useToast();
  async function share() {
    const data = { title: "Redart", text: "A reading ledger for engineers: plan your articles, tick them off, keep notes.", url: location.origin + "/" };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (e) { if (e instanceof DOMException && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(data.url); toast("Link copied. Paste it in your chat."); }
    catch { toast("Share this address: " + data.url); }
  }
  return <button className="btn ghost" type="button" onClick={share}>Share Redart with a friend</button>;
}
