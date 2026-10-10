import { pino, type Logger } from "pino";
import type { Env } from "./env";

// Never log credentials or private reading notes.
const REDACT = [
  "req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]',
  "*.password", "*.passwordHash", "*.token", "*.notes",
];

export function createLogger(env: Env): Logger {
  return pino({
    level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
    redact: { paths: REDACT, censor: "[redacted]" },
    ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { singleLine: true } } } : {}),
  });
}
