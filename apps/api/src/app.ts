import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import type { Db } from "./db";
import type { AppConfig } from "./config";
import { inspectRouter } from "./routes/inspect";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { meRouter } from "./routes/me";
import { ledgerRouter } from "./routes/ledger";
import { errorHandler, notFound } from "./middleware/errors";
import { loadSession } from "./middleware/auth";
import { requireSameOrigin } from "./middleware/csrf";
import { DbLinkCache } from "./services/linkCache";
import type { InspectDeps, LinkCache } from "./services/inspect";

export interface AppOptions {
  db: Db;
  config: AppConfig;
  logger?: Logger;
  trustProxy?: number;
  inspect?: InspectDeps;
  linkCache?: LinkCache;
}

/** Build the Express app. Tests import this directly; src/index.ts adds the listener. */
export function createApp(opts: AppOptions): Express {
  const { db, config } = opts;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", opts.trustProxy ?? 0);
  app.set("query parser", "simple");

  if (opts.logger) app.use(pinoHttp({ logger: opts.logger }));
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(express.json({ limit: "2mb" })); // a full ledger import can be large

  const api = express.Router();
  api.use(healthRouter(db));
  api.use(requireSameOrigin(config.appOrigin));
  api.use(loadSession(db, config));
  api.use(inspectRouter(opts.linkCache ?? new DbLinkCache(db), opts.inspect));
  api.use(authRouter(db, config));
  api.use(meRouter(db, config));
  api.use(ledgerRouter(db));
  app.use("/api", api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
