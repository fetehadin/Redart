import { test } from "vitest";
import assert from "node:assert/strict";
import { timeAgo } from "./timeAgo";

test("relative times read naturally", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(timeAgo("2026-10-10T11:59:30Z", now), "just now");
  assert.equal(timeAgo("2026-10-10T11:55:00Z", now), "5 min ago");
  assert.equal(timeAgo("2026-10-10T09:00:00Z", now), "3 h ago");
  assert.equal(timeAgo("2026-10-09T10:00:00Z", now), "yesterday");
  assert.equal(timeAgo("2026-10-07T12:00:00Z", now), "3 days ago");
  assert.equal(timeAgo("2026-09-01T12:00:00Z", now), "Sep 1");
});
