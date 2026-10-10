import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { applyOp, type LedgerState } from "@redart/shared";
import { LEDGER_KEY, LocalStore } from "./local";

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  quota = Infinity;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  }
}
const TODAY = "2026-10-10";

describe("LocalStore", () => {
  test("a first visit gets the starter plan, saved right away", async () => {
    const mem = new MemoryStorage();
    const s = await new LocalStore(mem).load(TODAY);
    assert.equal(s.plans.length, 1);
    assert.equal(s.plans[0]!.articles.length, 15);
    assert.ok(mem.getItem(LEDGER_KEY));
  });

  test("reads an existing v1 ledger", async () => {
    const mem = new MemoryStorage();
    mem.setItem("redart:v1", JSON.stringify({ version: 1, plans: [{ id: "p", name: "Old", start: "2026-01-01", days: 30, articles: [{ title: "A" }] }] }));
    const s = await new LocalStore(mem).load(TODAY);
    assert.equal(s.plans[0]!.name, "Old");
  });

  test("a corrupted save is set aside, not overwritten", async () => {
    const mem = new MemoryStorage();
    mem.setItem(LEDGER_KEY, "{not json");
    await new LocalStore(mem).load(TODAY);
    const kept = [...mem.data.keys()].find((k) => k.startsWith(`${LEDGER_KEY}:corrupt-`));
    assert.ok(kept);
    assert.equal(mem.getItem(kept!), "{not json");
  });

  test("notes save after a pause; other changes save at once", async () => {
    const mem = new MemoryStorage();
    const store = new LocalStore(mem);
    const s0 = await store.load(TODAY);
    const a = s0.plans[0]!.articles[0]!;
    const op = { type: "article.update" as const, planId: s0.active, articleId: a.id, patch: { notes: "hi" } };
    store.commit(op, applyOp(s0, op));
    assert.equal((JSON.parse(mem.getItem(LEDGER_KEY)!) as LedgerState).plans[0]!.articles[0]!.notes, "");
    store.flush();
    assert.equal((JSON.parse(mem.getItem(LEDGER_KEY)!) as LedgerState).plans[0]!.articles[0]!.notes, "hi");

    const done = { type: "article.update" as const, planId: s0.active, articleId: a.id, patch: { done: true } };
    store.commit(done, applyOp(s0, done));
    assert.equal((JSON.parse(mem.getItem(LEDGER_KEY)!) as LedgerState).plans[0]!.articles[0]!.done, true);
  });

  test("full storage is reported, then cleared once a save works", async () => {
    const mem = new MemoryStorage();
    const store = new LocalStore(mem);
    const problems: (string | null)[] = [];
    store.onProblem((p) => problems.push(p));
    const s0 = await store.load(TODAY);
    mem.quota = 10;
    const op = { type: "prefs.theme" as const, theme: "dark" as const };
    store.commit(op, applyOp(s0, op));
    mem.quota = Infinity;
    store.commit(op, applyOp(s0, op));
    assert.deepEqual(problems, [null, "quota", null]);
  });

  test("blocked storage is reported and nothing throws", async () => {
    const store = new LocalStore(null);
    let problem: string | null = null;
    store.onProblem((p) => { problem = p; });
    const s = await store.load(TODAY);
    assert.equal(s.plans.length, 1);
    assert.equal(problem, "blocked");
  });
});
