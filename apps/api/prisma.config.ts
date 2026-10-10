import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma doesn't read .env files itself; load the repo-root one when present.
try { process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env")); } catch { /* use the real environment */ }

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // Read lazily: `prisma generate` (at install and image build time) needs no database.
  // Commands that do need one (migrate, seed) fail with a clear connection error when it's missing.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
