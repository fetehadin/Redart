import { articlesFromRows, sanitizeState, SCHEMA_VERSION, STARTER, todayISO, uid, type ISODate, type LedgerOp, type LedgerState } from "@redart/shared";
import type { LedgerStore, StoreProblem } from "./types";

export const LEDGER_KEY = "redart:v2";
const LEGACY_KEYS = ["redart:v1"];
const NOTES_DELAY_MS = 400;

/** The ledger a first-time guest sees: the starter list as a 30-day plan. */
export function freshState(today: ISODate): LedgerState {
  const articles = articlesFromRows(STARTER, today, 30).map((a) => ({ ...a, minutesAuto: true }));
  const p = { id: uid(), name: "Backend & AI reading — 30 days", start: today, days: 30, articles };
  return { version: SCHEMA_VERSION, active: p.id, plans: [p], favorites: [], prefs: { theme: "system" } };
}

/** Typing a note saves a moment later; everything else saves at once. */
const isNotesOnly = (op: LedgerOp) =>
  op.type === "article.update" && Object.keys(op.patch).length === 1 && "notes" in op.patch;

export class LocalStore implements LedgerStore {
  readonly kind = "local" as const;
  private pending: LedgerState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private problem: StoreProblem | null = null;
  private problemListeners = new Set<(p: StoreProblem | null) => void>();

  constructor(private readonly storage: Storage | null, private readonly win: Pick<Window, "addEventListener" | "removeEventListener"> | null = null) {}

  async load(today: ISODate): Promise<LedgerState> {
    const raw = this.read(LEDGER_KEY) ?? LEGACY_KEYS.map((k) => this.read(k)).find((v) => v != null) ?? null;
    if (raw) {
      try {
        const s = sanitizeState(JSON.parse(raw), today);
        if (s) return s;
      } catch { /* fall through */ }
      // Unreadable: keep the bad copy aside instead of overwriting it.
      this.write(`${LEDGER_KEY}:corrupt-${Date.now()}`, raw);
    }
    if (!this.probe()) this.setProblem("blocked");
    const fresh = freshState(today);
    this.save(fresh);
    return fresh;
  }

  commit(op: LedgerOp, next: LedgerState): void {
    this.pending = next;
    if (this.timer) clearTimeout(this.timer);
    if (isNotesOnly(op)) this.timer = setTimeout(() => this.flush(), NOTES_DELAY_MS);
    else this.flush();
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return;
    const s = this.pending;
    this.pending = null;
    this.save(s);
  }

  subscribe(listener: (s: LedgerState) => void): () => void {
    if (!this.win) return () => {};
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LEDGER_KEY || !e.newValue) return;
      try {
        const s = sanitizeState(JSON.parse(e.newValue), todayISO());
        if (s) listener(s);
      } catch { /* ignore another tab's half-written value */ }
    };
    this.win.addEventListener("storage", onStorage as EventListener);
    return () => this.win?.removeEventListener("storage", onStorage as EventListener);
  }

  onProblem(listener: (p: StoreProblem | null) => void): () => void {
    this.problemListeners.add(listener);
    listener(this.problem);
    return () => { this.problemListeners.delete(listener); };
  }

  private save(s: LedgerState): void {
    if (!this.storage || this.problem === "blocked") return;
    try {
      this.storage.setItem(LEDGER_KEY, JSON.stringify(s));
      if (this.problem === "quota") this.setProblem(null);
    } catch (e) {
      this.setProblem(e instanceof DOMException && e.name === "QuotaExceededError" ? "quota" : "blocked");
    }
  }

  private setProblem(p: StoreProblem | null) {
    this.problem = p;
    for (const l of this.problemListeners) l(p);
  }

  private read(key: string): string | null {
    try { return this.storage?.getItem(key) ?? null; } catch { return null; }
  }
  private write(key: string, value: string) {
    try { this.storage?.setItem(key, value); } catch { /* ignore */ }
  }
  private probe(): boolean {
    try {
      if (!this.storage) return false;
      this.storage.setItem(`${LEDGER_KEY}:probe`, "1");
      this.storage.removeItem(`${LEDGER_KEY}:probe`);
      return true;
    } catch { return false; }
  }
}
