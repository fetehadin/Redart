import { afterAll, beforeEach, inject } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp, type AppOptions } from "../src/app";
import { createDb, type Db } from "../src/db";
import type { AppConfig } from "../src/config";
import { MemoryLinkCache } from "../src/services/inspect";
import type { Mailer } from "../src/services/mail";

export const ORIGIN = "http://localhost:3000";

let shared: Db | null = null;
/** One Prisma client per test file, cleaned between tests. */
export function useDb(): () => Db {
  shared ??= createDb(inject("databaseUrl"));
  beforeEach(async () => { await resetDb(shared!); });
  afterAll(async () => { await shared?.$disconnect(); shared = null; });
  return () => shared!;
}

export async function resetDb(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export interface SentMail { to: string; subject: string; text: string }
export function fakeMailer(): Mailer & { sent: SentMail[] } {
  const sent: SentMail[] = [];
  return { sent, send: async (to, subject, text) => { sent.push({ to, subject, text }); } };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { appOrigin: ORIGIN, cookieName: "redart_session", secureCookies: false, adminEmails: [], mailer: null, ...overrides };
}

export function makeApp(db: Db, opts: Partial<AppOptions> = {}): Express {
  return createApp({ db, config: testConfig(), linkCache: new MemoryLinkCache(), ...opts });
}

/** A cookie-keeping client that sends our Origin on writes, like the browser does. */
export function client(app: Express) {
  const agent = request.agent(app);
  return {
    agent,
    get: (path: string) => agent.get(path),
    post: (path: string, body?: object) => agent.post(path).set("origin", ORIGIN).send(body ?? {}),
    patch: (path: string, body?: object) => agent.patch(path).set("origin", ORIGIN).send(body ?? {}),
    del: (path: string, body?: object) => agent.delete(path).set("origin", ORIGIN).send(body ?? {}),
  };
}
export type Client = ReturnType<typeof client>;

let n = 0;
/** Sign up a fresh user and return their signed-in client. */
export async function signedUp(app: Express, fields: Partial<{ email: string; handle: string; displayName: string; password: string }> = {}) {
  n++;
  const body = { email: `reader${n}@example.com`, handle: `reader_${n}`, displayName: `Reader ${n}`, password: "correct horse battery", ...fields };
  const c = client(app);
  const res = await c.post("/api/auth/signup", body);
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { c, user: res.body.user as { id: string; handle: string; email: string }, password: body.password };
}
