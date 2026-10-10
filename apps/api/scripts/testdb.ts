// A throwaway PostgreSQL 17 with Redart's migrations applied. Used by the API tests and the e2e run.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const API_DIR = path.resolve(import.meta.dirname, "..");

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
  s.on("error", reject);
});

export function migrate(url: string) {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: API_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}

export async function startTestDb(name = "redart_test"): Promise<{ url: string; stop: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), "redart-test-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "redart", password: "redart", port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(name);
  const url = `postgresql://redart:redart@localhost:${port}/${name}`;
  migrate(url);
  return { url, stop: async () => { await pg.stop(); rmSync(dir, { recursive: true, force: true }); } };
}
