// The shape of GET /api/inspect responses.
import type { LinkStatus } from "./core";

export type InspectStatus = LinkStatus | "rate_limited";

export interface InspectResult {
  url: string;
  checkedAt: string;
  status: InspectStatus;
  message: string;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  title?: string;
  siteName?: string;
  words?: number;
  minutes?: number | null;
  confidence?: "high" | "low";
}
