// Starts a throwaway PostgreSQL for the test run and applies the migrations.
import type { TestProject } from "vitest/node";
import { migrate, startTestDb } from "../scripts/testdb";

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}

export default async function setup(project: TestProject) {
  // An externally provided database (e.g. a CI service container) skips the embedded one.
  if (process.env.TEST_DATABASE_URL) {
    migrate(process.env.TEST_DATABASE_URL);
    project.provide("databaseUrl", process.env.TEST_DATABASE_URL);
    return;
  }
  const db = await startTestDb();
  project.provide("databaseUrl", db.url);
  return db.stop;
}
