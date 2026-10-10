// A member's ledger, synced with the API. Changes apply instantly on screen and are sent as LedgerOps in order.
// Unsent ops are kept in localStorage, so closing the tab while offline doesn't lose them.
import { sanitizeState, todayISO, type ISODate, type LedgerOp, type LedgerState } from "@redart/shared";
import { api, ApiError } from "../api";
import type { LedgerStore, StoreProblem } from "./types";

const NOTES_DELAY_MS = 600;
const MAX_BATCH = 200;
const MAX_RETRY_MS = 30_000;

export const memberKeyPrefix = (userId: string) => `redart:member:${userId}:`;

const isNotesOnly = (op: LedgerOp) => op.type === "article.update" && Object.keys(op.patch).length === 1 && "notes" in op.patch;

export class RemoteStore implements LedgerStore {
  readonly kind = "remote" as const;
  private queue: LedgerOp[] = [];
  private inFlight = 0; // ops at the head of the queue currently being sent
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 2000;
  private problem: StoreProblem | null = null;
  private listeners = new Set<(s: LedgerState) => void>();
  private problemListeners = new Set<(p: StoreProblem | null) => void>();
  private channel: BroadcastChannel | null = null;
  private onOnline = () => this.send();

  constructor(private readonly userId: string, private readonly storage: Storage | null) {
    this.queue = this.readPending();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`redart-ledger-${userId}`);
      this.channel.onmessage = () => { void this.reload(); };
    }
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  async load(today: ISODate): Promise<LedgerState> {
    if (this.queue.length) await this.send();
    try {
      const { state } = await api<{ state: LedgerState }>(`/api/ledger?today=${today}`);
      this.writeCache(state);
      return state;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.setProblem("signed-out");
      // Offline: show the last copy we saw, if any.
      const cached = this.readCache(today);
      if (cached && e instanceof ApiError && e.isNetwork) { this.setProblem("unsynced"); return cached; }
      throw e;
    }
  }

  commit(op: LedgerOp, next: LedgerState): void {
    this.writeCache(next);
    if (op.type === "prefs.theme") return; // the theme lives in the browser
    const last = this.queue[this.queue.length - 1];
    // Typing a note sends one update, not one per keystroke.
    if (last && this.queue.length > this.inFlight && isNotesOnly(op) && isNotesOnly(last)
      && last.type === "article.update" && op.type === "article.update" && last.articleId === op.articleId) {
      this.queue[this.queue.length - 1] = op;
    } else {
      this.queue.push(op);
    }
    this.writePending();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.send(), isNotesOnly(op) ? NOTES_DELAY_MS : 0);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.queue.length || this.inFlight) return;
    // The page may be closing: keepalive lets the request outlive it. The pending copy covers failures.
    void this.send(true);
  }

  subscribe(listener: (s: LedgerState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onProblem(listener: (p: StoreProblem | null) => void): () => void {
    this.problemListeners.add(listener);
    listener(this.problem);
    return () => { this.problemListeners.delete(listener); };
  }

  /** Fetch the ledger from the server and show it. */
  async reload(): Promise<void> {
    try {
      const { state } = await api<{ state: LedgerState }>(`/api/ledger?today=${todayISO()}`);
      if (this.queue.length) return; // local changes still on their way; they win
      this.writeCache(state);
      for (const l of this.listeners) l(state);
    } catch { /* keep what's on screen */ }
  }

  dispose() {
    this.channel?.close();
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
  }

  private async send(keepalive = false): Promise<void> {
    if (this.inFlight || !this.queue.length) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const batch = this.queue.slice(0, MAX_BATCH);
    this.inFlight = batch.length;
    try {
      const res = await api<{ reload: boolean }>(`/api/ledger/ops?today=${todayISO()}`, { body: { ops: batch }, keepalive });
      this.queue.splice(0, batch.length);
      this.inFlight = 0;
      this.writePending();
      this.retryMs = 2000;
      if (this.problem === "unsynced" || this.problem === "rejected") this.setProblem(null);
      this.channel?.postMessage("changed");
      if (res.reload) await this.reload();
      if (this.queue.length) await this.send();
    } catch (e) {
      this.inFlight = 0;
      if (e instanceof ApiError && e.status === 401) { this.setProblem("signed-out"); return; }
      if (e instanceof ApiError && !e.isNetwork) {
        // The server refused (stale or invalid change): drop it and show the server's version.
        this.queue.splice(0, batch.length);
        this.writePending();
        this.setProblem("rejected");
        await this.reload();
        if (this.queue.length) await this.send();
        return;
      }
      this.setProblem("unsynced");
      this.timer = setTimeout(() => this.send(), this.retryMs);
      this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
    }
  }

  private setProblem(p: StoreProblem | null) {
    if (this.problem === p) return;
    this.problem = p;
    for (const l of this.problemListeners) l(p);
  }

  private key(name: string) { return memberKeyPrefix(this.userId) + name; }
  private readPending(): LedgerOp[] {
    try { const v = JSON.parse(this.storage?.getItem(this.key("pending")) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  private writePending() {
    try {
      if (this.queue.length) this.storage?.setItem(this.key("pending"), JSON.stringify(this.queue));
      else this.storage?.removeItem(this.key("pending"));
    } catch { /* storage full or blocked: the in-memory queue still works */ }
  }
  private readCache(today: ISODate): LedgerState | null {
    try { return sanitizeState(JSON.parse(this.storage?.getItem(this.key("cache")) ?? "null"), today); } catch { return null; }
  }
  private writeCache(s: LedgerState) {
    try { this.storage?.setItem(this.key("cache"), JSON.stringify(s)); } catch { /* best effort */ }
  }
}

/** Forget every member's cached ledger on this device (on sign out). */
export function clearMemberData(storage: Storage | null) {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith("redart:member:")) keys.push(k); }
    keys.forEach((k) => storage.removeItem(k));
  } catch { /* ignore */ }
}
