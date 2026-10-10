import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma doesn't read .env files itself; load the repo-root one when present.
try { process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env")); } catch { /* use the real environment */ }

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: env("DATABASE_URL") },
});
