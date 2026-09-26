import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePeriod, parseUntil } from "../src/period.ts";

test("period parsing", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(parsePeriod(undefined, undefined, now), now - 30 * 864e5);
  assert.equal(parsePeriod("2w", undefined, now), now - 14 * 864e5);
  assert.equal(parsePeriod("12h", undefined, now), now - 12 * 3600e3);
  assert.equal(parsePeriod(undefined, "2026-09-01T00:00:00Z", now), Date.parse("2026-09-01T00:00:00Z"));
  assert.throws(() => parsePeriod("30 days", undefined, now));
  assert.throws(() => parsePeriod(undefined, "yesterday", now));
});

test("--until parsing", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(parseUntil(undefined, now), now);
  assert.equal(parseUntil("2026-09-20T10:00:00Z", now), Date.parse("2026-09-20T10:00:00Z"));
  assert.throws(() => parseUntil("soon", now));
});

test("a date without zero-padding means the same day as the padded one; other forms are refused", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(parseUntil("2026-9-26", now), parseUntil("2026-09-26", now), "the end of that day, not its midnight");
  assert.equal(parseUntil("2026-09-26", now), new Date(2026, 8, 26, 23, 59, 59, 999).getTime());
  assert.equal(parsePeriod(undefined, "2026-9-1", now), new Date(2026, 8, 1).getTime());
  assert.equal(parseUntil("2026-9-26T10:00", now), new Date(2026, 8, 26, 10).getTime(), "a time is kept as given");
  for (const v of ["2026-02-30", "2026-13-01", "Sep 26 2026", "2026/09/26", "26.09.2026"]) {
    assert.throws(() => parseUntil(v, now), new RegExp(`--until: not a date: ${v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\(expected YYYY-MM-DD`), v);
    assert.throws(() => parsePeriod(undefined, v, now), /--since: not a date/, v);
  }
});
