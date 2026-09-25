import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePeriod } from "../src/period.ts";

test("period parsing", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(parsePeriod(undefined, undefined, now), now - 30 * 864e5);
  assert.equal(parsePeriod("2w", undefined, now), now - 14 * 864e5);
  assert.equal(parsePeriod("12h", undefined, now), now - 12 * 3600e3);
  assert.equal(parsePeriod(undefined, "2026-09-01T00:00:00Z", now), Date.parse("2026-09-01T00:00:00Z"));
  assert.throws(() => parsePeriod("30 days", undefined, now));
  assert.throws(() => parsePeriod(undefined, "yesterday", now));
});
