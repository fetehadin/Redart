import type { z } from "zod";
import { HttpError } from "./errors";

/** Parse `data` with `schema`, or throw a 400 that names each bad field. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "body";
    fields[key] ??= issue.message;
  }
  const first = Object.values(fields)[0] ?? "Check the highlighted fields.";
  throw new HttpError(400, "VALIDATION", first, fields);
}
