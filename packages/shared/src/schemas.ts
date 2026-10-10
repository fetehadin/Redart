// Zod schemas shared by web forms and the API. The API never trusts a body that hasn't passed one of these.
import { z } from "zod";
import { LIMITS, parseISO, safeUrl } from "./core";

export const ACCOUNT_LIMITS = {
  handleMin: 3, handleMax: 20, displayName: 50, bio: 160, passwordMin: 10, passwordMax: 200, email: 254, topics: 12,
} as const;

export const isoDate = z.string().refine((s) => parseISO(s) !== null, "Use a real date (YYYY-MM-DD).");
const httpUrlOrEmpty = z.string().max(2048).refine((s) => s === "" || safeUrl(s) === s, "Use a full http(s) link.");

export const linkCheckSchema = z.object({
  status: z.enum(["ok", "broken", "restricted", "unreachable", "timeout", "invalid", "blocked"]),
  httpStatus: z.number().int().nullable(),
  message: z.string().max(300),
  checkedAt: z.iso.datetime({ offset: true }),
});

export const articleSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(LIMITS.title),
  url: httpUrlOrEmpty,
  topic: z.string().max(LIMITS.topic),
  minutes: z.number().int().min(LIMITS.minMinutes).max(LIMITS.maxMinutes),
  minutesAuto: z.boolean(),
  due: isoDate,
  done: z.boolean(),
  doneAt: isoDate.nullable(),
  notes: z.string().max(LIMITS.notes),
  link: linkCheckSchema.nullable(),
});

export const planSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(LIMITS.planName),
  start: isoDate,
  days: z.number().int().min(LIMITS.minDays).max(LIMITS.maxDays),
  articles: z.array(articleSchema).max(1000),
  shared: z.boolean().optional(),
});

export const favoriteSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(LIMITS.title),
  url: httpUrlOrEmpty,
  topic: z.string().max(LIMITS.topic),
  minutes: z.number().int().min(LIMITS.minMinutes).max(LIMITS.maxMinutes),
  savedAt: isoDate,
});

export const articlePatchSchema = articleSchema.omit({ id: true }).partial();
export const favoritePatchSchema = favoriteSchema.omit({ id: true }).partial();
const index = z.number().int().min(0).max(100_000).optional();

export const ledgerOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plan.create"), plan: planSchema, index }),
  z.object({ type: z.literal("plan.update"), planId: z.uuid(), name: planSchema.shape.name, start: isoDate, days: planSchema.shape.days }),
  z.object({ type: z.literal("plan.delete"), planId: z.uuid() }),
  z.object({ type: z.literal("plan.select"), planId: z.uuid() }),
  z.object({ type: z.literal("plan.setShared"), planId: z.uuid(), shared: z.boolean() }),
  z.object({ type: z.literal("plan.setDues"), planId: z.uuid(), dues: z.record(z.uuid(), isoDate) }),
  z.object({ type: z.literal("article.add"), planId: z.uuid(), article: articleSchema, index }),
  z.object({ type: z.literal("article.update"), planId: z.uuid(), articleId: z.uuid(), patch: articlePatchSchema }),
  z.object({ type: z.literal("article.remove"), planId: z.uuid(), articleId: z.uuid() }),
  z.object({ type: z.literal("article.move"), planId: z.uuid(), articleId: z.uuid(), to: z.number().int().min(0).max(100_000) }),
  z.object({ type: z.literal("favorite.add"), favorite: favoriteSchema, index }),
  z.object({ type: z.literal("favorite.update"), favoriteId: z.uuid(), patch: favoritePatchSchema }),
  z.object({ type: z.literal("favorite.remove"), favoriteId: z.uuid() }),
  z.object({ type: z.literal("prefs.theme"), theme: z.enum(["light", "dark", "system"]) }),
  // Restoring a backup: the server re-checks it with sanitizeState and gives everything fresh ids.
  z.object({ type: z.literal("state.replace"), state: z.unknown() }),
]);

export const ledgerOpsBody = z.object({ ops: z.array(ledgerOpSchema).min(1).max(200) });

/* ---------- accounts ---------- */

export const handleSchema = z.string().trim().toLowerCase()
  .min(ACCOUNT_LIMITS.handleMin, `Handles are at least ${ACCOUNT_LIMITS.handleMin} characters.`)
  .max(ACCOUNT_LIMITS.handleMax, `Handles are at most ${ACCOUNT_LIMITS.handleMax} characters.`)
  .regex(/^[a-z0-9_]+$/, "Use only letters, numbers and underscores.");
export const emailSchema = z.string().trim().toLowerCase().max(ACCOUNT_LIMITS.email).pipe(z.email("That email address doesn't look right."));
export const passwordSchema = z.string()
  .min(ACCOUNT_LIMITS.passwordMin, `Use at least ${ACCOUNT_LIMITS.passwordMin} characters.`)
  .max(ACCOUNT_LIMITS.passwordMax, "That password is too long.");
export const displayNameSchema = z.string().trim().min(1, "Tell people what to call you.").max(ACCOUNT_LIMITS.displayName);
export const topicsSchema = z.array(z.string().trim().min(1).max(LIMITS.topic)).max(ACCOUNT_LIMITS.topics);

export const signupBody = z.object({
  email: emailSchema, password: passwordSchema, handle: handleSchema, displayName: displayNameSchema,
});
export const signinBody = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(ACCOUNT_LIMITS.passwordMax) });
export const resetRequestBody = z.object({ email: emailSchema });
export const resetConfirmBody = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

export const updateMeBody = z.object({
  displayName: displayNameSchema.optional(),
  handle: handleSchema.optional(),
  bio: z.string().trim().max(ACCOUNT_LIMITS.bio).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  topics: topicsSchema.optional(),
});
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(ACCOUNT_LIMITS.passwordMax), newPassword: passwordSchema });
export const deleteMeBody = z.object({ password: z.string().min(1).max(ACCOUNT_LIMITS.passwordMax) });
export const importBody = z.object({ state: z.unknown() });

export type LedgerOpInput = z.infer<typeof ledgerOpSchema>;

export const searchQuery = z.object({ q: z.string().trim().min(1).max(50) });
