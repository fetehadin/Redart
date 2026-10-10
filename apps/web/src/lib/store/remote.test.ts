import { afterEach, beforeEach, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { applyOp, newArticle, uid, type LedgerOp, type LedgerState } from "@redart/shared";
import { RemoteStore, memberKeyPrefix } from "./remote";

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

const USER = "u1";
function state(): LedgerState {
  const a = newArticle({ title: "A" }, "2026-10-01");
  return { version: 2, active: "p", plans: [{ id: "p", name: "P", start: "2026-10-01", days: 30, articles: [a] }], favorites: [], prefs: { theme: "system" } };
}

let sent: LedgerOp[][];
let respond: (ops: LedgerOp[]) => Response;
beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  respond = () => Response.json({ reload: false });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/ledger/ops")) {
      const ops = JSON.parse(String(init!.body)).ops as LedgerOp[];
      sent.push(ops);
      return respond(ops);
    }
    return Response.json({ state: state() });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const notes = (s: LedgerState, text: string): LedgerOp =>
  ({ type: "article.update", planId: "p", articleId: s.plans[0]!.articles[0]!.id, patch: { notes: text } });

describe("RemoteStore", () => {
  test("typing a note sends one update with the final text", async () => {
    const store = new RemoteStore(USER, new MemoryStorage() as unknown as Storage);
    const s = state();
    for (const t of ["H", "He", "Hel", "Hello"]) store.commit(notes(s, t), applyOp(s, notes(s, t)));
    await vi.advanceTimersByTimeAsync(700);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.length, 1);
    assert.deepEqual((sent[0]![0] as Extract<LedgerOp, { type: "article.update" }>).patch, { notes: "Hello" });
  });

  test("other changes go out at once, in order; the theme never leaves the browser", async () => {
    const store = new RemoteStore(USER, new MemoryStorage() as unknown as Storage);
    const s = state();
    const id = s.plans[0]!.articles[0]!.id;
    store.commit({ type: "prefs.theme", theme: "dark" }, s);
    store.commit({ type: "article.update", planId: "p", articleId: id, patch: { done: true } }, s);
    store.commit({ type: "plan.select", planId: "p" }, s);
    await vi.advanceTimersByTimeAsync(50);
    const all = sent.flat();
    assert.deepEqual(all.map((o) => o.type), ["article.update", "plan.select"]);
  });

  test("unsent changes survive a reload while offline, and go out when the server is back", async () => {
    const storage = new MemoryStorage() as unknown as Storage;
    respond = () => { throw new TypeError("network down"); };
    const store = new RemoteStore(USER, storage);
    const problems: (string | null)[] = [];
    store.onProblem((p) => problems.push(p));
    const s = state();
    const op: LedgerOp = { type: "plan.create", plan: { id: uid(), name: "New", start: "2026-11-01", days: 30, articles: [] } };
    store.commit(op, applyOp(s, op));
    await vi.advanceTimersByTimeAsync(10);
    assert.ok(problems.includes("unsynced"));
    assert.ok(storage.getItem(memberKeyPrefix(USER) + "pending"));
    store.dispose();

    // New page load: the pending op is sent before the ledger is fetched.
    respond = () => Response.json({ reload: false });
    sent = [];
    const again = new RemoteStore(USER, storage);
    await again.load("2026-10-10");
    assert.deepEqual(sent.flat().map((o) => o.type), ["plan.create"]);
    assert.equal(storage.getItem(memberKeyPrefix(USER) + "pending"), null);
  });

  test("a refused change is dropped and the server's ledger is shown", async () => {
    respond = () => Response.json({ error: { code: "NOT_FOUND", message: "gone" } }, { status: 404 });
    const store = new RemoteStore(USER, new MemoryStorage() as unknown as Storage);
    const shown: LedgerState[] = [];
    store.subscribe((s) => shown.push(s));
    const problems: (string | null)[] = [];
    store.onProblem((p) => problems.push(p));
    store.commit({ type: "plan.select", planId: "p" }, state());
    await vi.advanceTimersByTimeAsync(10);
    assert.ok(problems.includes("rejected"));
    assert.equal(shown.length, 1);
  });
});
