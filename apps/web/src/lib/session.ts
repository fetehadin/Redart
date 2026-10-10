// Server-side: who is signed in? Asks the API with the visitor's own cookie. Deduplicated per request.
import { cache } from "react";
import { cookies } from "next/headers";
import type { Me } from "@redart/shared";

export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? process.env.API_ORIGIN ?? "http://localhost:4000";
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "redart_session";

/** GET from the API as the current visitor. Server components only. */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
  try {
    const res = await fetch(`${INTERNAL_API_URL}${path}`, { headers: { cookie, accept: "application/json" }, cache: "no-store" });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { status: 503, data: null };
  }
}

export const getCurrentUser = cache(async (): Promise<Me | null> => {
  if (!(await cookies()).has(SESSION_COOKIE_NAME)) return null;
  const { data } = await serverApi<{ user: Me }>("/api/me");
  return data?.user ?? null;
});
