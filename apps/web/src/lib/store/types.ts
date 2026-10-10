import type { ISODate, LedgerOp, LedgerState } from "@redart/shared";

export type StoreProblem = "blocked" | "quota";

/**
 * Where a ledger lives. The UI only talks to this interface:
 * LocalStore keeps a guest's ledger in the browser; RemoteStore (phase 2) syncs a member's with the API.
 */
export interface LedgerStore {
  readonly kind: "local" | "remote";
  load(today: ISODate): Promise<LedgerState>;
  /** Persist after `op` produced `next`. */
  commit(op: LedgerOp, next: LedgerState): void;
  /** Write anything still pending (page hidden or closing). */
  flush(): void;
  /** Changes made elsewhere (another tab). Returns an unsubscribe function. */
  subscribe(listener: (s: LedgerState) => void): () => void;
  /** Problems the reader should know about, such as blocked or full storage. */
  onProblem(listener: (p: StoreProblem | null) => void): () => void;
}
