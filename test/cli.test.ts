import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePeriod, parseUntil, periodOf } from "../src/period.ts";

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

test("--last counts back from --until, and a --since after the end is an error", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const end = new Date(2026, 8, 22, 23, 59, 59, 999).getTime();
  assert.deepEqual(periodOf({ last: "7d", until: "2026-09-22" }, now), { sinceMs: end - 7 * 864e5, untilMs: end });
  // The default 30 days end at --until too, however long ago that is.
  const old = new Date(2026, 7, 15, 23, 59, 59, 999).getTime();
  assert.deepEqual(periodOf({ until: "2026-08-15" }, now), { sinceMs: old - 30 * 864e5, untilMs: old });
  assert.deepEqual(periodOf({}, now), { sinceMs: now - 30 * 864e5, untilMs: now });
  assert.deepEqual(periodOf({ since: "2026-09-26", until: "2026-09-26" }, now), { sinceMs: new Date(2026, 8, 26).getTime(), untilMs: new Date(2026, 8, 26, 23, 59, 59, 999).getTime() }, "one whole day");
  assert.throws(() => periodOf({ since: "2026-09-25", until: "2026-09-01" }, now), /^Error: --since 2026-09-25 is after --until 2026-09-01$/);
  assert.throws(() => periodOf({ since: "2026-12-01" }, now), /^Error: --since 2026-12-01 is in the future$/);
});
