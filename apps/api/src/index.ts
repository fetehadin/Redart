import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { createApp } from "./app";
import { createDb } from "./db";
import { smtpMailer } from "./services/mail";
import { setRateLimitScale } from "./middleware/rateLimits";

const env = loadEnv();
const logger = createLogger(env);
setRateLimitScale(env.RATE_LIMIT_SCALE);
const db = createDb(env.DATABASE_URL);
const mailer = env.SMTP_HOST && env.SMTP_FROM
  ? smtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM })
  : null;

const app = createApp({
  db, logger, trustProxy: env.TRUST_PROXY,
  config: {
    appOrigin: env.APP_ORIGIN,
    cookieName: env.SESSION_COOKIE_NAME,
    secureCookies: env.APP_ORIGIN.startsWith("https://"),
    adminEmails: env.ADMIN_EMAILS,
    mailer,
  },
});

const server = app.listen(env.PORT, () => logger.info(`API listening on :${env.PORT}${mailer ? "" : " (no SMTP: password reset by email is off)"}`));

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => { await db.$disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
