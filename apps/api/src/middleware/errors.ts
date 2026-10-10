import type { ErrorRequestHandler, RequestHandler } from "express";

export type ErrorCode = "NOT_FOUND" | "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const errorBody = (code: ErrorCode, message: string, fields?: Record<string, string>) =>
  ({ error: fields ? { code, message, fields } : { code, message } });

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody("NOT_FOUND", "There's nothing here."));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(errorBody(err.code, err.message, err.fields));
    return;
  }
  // Malformed JSON bodies from express.json()
  if (err && typeof err === "object" && "type" in err && err.type === "entity.parse.failed") {
    res.status(400).json(errorBody("VALIDATION", "The request body isn't valid JSON."));
    return;
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.too.large") {
    res.status(413).json(errorBody("VALIDATION", "The request is too large."));
    return;
  }
  req.log?.error({ err }, "unhandled error");
  res.status(500).json(errorBody("INTERNAL", "Something went wrong on our side. Try again in a moment."));
};
