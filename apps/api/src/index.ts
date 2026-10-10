import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { createApp } from "./app";

const env = loadEnv();
const logger = createLogger(env);
const app = createApp({ logger, trustProxy: env.TRUST_PROXY });

const server = app.listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`));

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
