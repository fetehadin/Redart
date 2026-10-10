// A real PostgreSQL 17 for local development, run as your own user: no Docker or sudo needed.
// Data lives in apps/api/.data/postgres. Stop with Ctrl+C.
import path from "node:path";
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const dir = path.resolve(import.meta.dirname, "../.data/postgres");
const port = Number(process.env.DEV_DB_PORT ?? 5544);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "redart", password: "redart", port, persistent: true, onLog: () => {} });

const fresh = !existsSync(path.join(dir, "PG_VERSION"));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("redart");
console.log(`Postgres ready: postgresql://redart:redart@localhost:${port}/redart`);

const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
