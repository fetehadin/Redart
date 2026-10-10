import { z } from "zod";

const optional = z.string().trim().optional().transform((v) => v || undefined);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Number of reverse proxies in front of the API (Caddy = 1). Needed for correct client IPs in rate limits.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(1000).default(1),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // The site's public origin. State-changing requests must come from it (CSRF protection).
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default("redart_session"),
  ADMIN_EMAILS: z.string().default("").transform((s) => s.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: optional,
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
