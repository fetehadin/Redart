// Browser-side calls to our API. Errors come back as ApiError with the server's code, message and field errors.
import type { ApiErrorBody, ApiErrorCode } from "@redart/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode | "NETWORK",
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
  get isNetwork() { return this.code === "NETWORK" || this.status >= 500 || this.status === 429; }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: init.body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      keepalive: init.keepalive,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Couldn't reach Redart. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? (res.status >= 500 ? "INTERNAL" : "VALIDATION"), e?.message ?? "Something went wrong. Try again.", e?.fields);
  }
  return data as T;
}
