// Usage: tsx scripts/with-test-db.ts [--cwd dir] -- <command...>
// Runs the command with DATABASE_URL pointing at a fresh, migrated, throwaway database.
import { spawn } from "node:child_process";
import path from "node:path";
import { startTestDb } from "./testdb";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const opts = sep >= 0 ? args.slice(0, sep) : [];
const cmd = sep >= 0 ? args.slice(sep + 1) : args;
const cwdIdx = opts.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? path.resolve(opts[cwdIdx + 1]!) : process.cwd();
if (!cmd.length) { console.error("No command given."); process.exit(2); }

const db = await startTestDb("redart_e2e");
const child = spawn(cmd[0]!, cmd.slice(1), { cwd, stdio: "inherit", env: { ...process.env, DATABASE_URL: db.url } });
const code: number = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
await db.stop();
process.exit(code);
