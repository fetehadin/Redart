import type { ISODate, LedgerOp, LedgerState } from "@redart/shared";

/**
 * blocked / quota: the browser won't keep a guest's ledger.
 * unsynced: a member's changes are waiting to reach the server (offline or server trouble).
 * rejected: the server refused a change; the ledger was reloaded from the server.
 * signed-out: the session ended; changes can't be saved until the member signs in again.
 */
export type StoreProblem = "blocked" | "quota" | "unsynced" | "rejected" | "signed-out";

/**
 * Where a ledger lives. The UI only talks to this interface:
 * LocalStore keeps a guest's ledger in the browser; RemoteStore syncs a member's with the API.
 */
export interface LedgerStore {
  readonly kind: "local" | "remote";
  load(today: ISODate): Promise<LedgerState>;
  /** Persist after `op` produced `next`. */
  commit(op: LedgerOp, next: LedgerState): void;
  /** Write anything still pending (page hidden or closing). */
  flush(): void;
  /** Changes made elsewhere (another tab, or a reload from the server). Returns an unsubscribe function. */
  subscribe(listener: (s: LedgerState) => void): () => void;
  /** Problems the reader should know about. */
  onProblem(listener: (p: StoreProblem | null) => void): () => void;
}
