import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { inspectRouter } from "./routes/inspect";
import { healthRouter } from "./routes/health";
import { errorHandler, notFound } from "./middleware/errors";
import type { InspectDeps } from "./services/inspect";

export interface AppOptions {
  logger?: Logger;
  trustProxy?: number;
  inspect?: InspectDeps;
}

/** Build the Express app. Tests import this directly; src/index.ts adds the listener. */
export function createApp(opts: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", opts.trustProxy ?? 0);
  app.set("query parser", "simple");

  if (opts.logger) app.use(pinoHttp({ logger: opts.logger }));
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(express.json({ limit: "200kb" }));

  const api = express.Router();
  api.use(healthRouter());
  api.use(inspectRouter(opts.inspect));
  app.use("/api", api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
