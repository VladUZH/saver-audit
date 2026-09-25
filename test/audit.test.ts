import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAudit } from "../src/pool.ts";
import { renderJson } from "../src/report/json.ts";
import { FIXTURES, fixtureOptions } from "./helpers.ts";

// Hand-computed from the fixtures and the bundled prices (USD per 1M tokens):
//   msg_1 opus-5.5:   3×4 + 1000×8 (1h write) + 50×20            = 9012
//   msg_2 opus-5.5:   2×4 + 500×5 + 1000×0.2 + 30×20              = 3308
//   msg_3 sonnet-5:   10×2 + 2000×0.2 + 5×10  = 470, + 2 searches × $0.01
//   msg_4 haiku-4.5:  5×1 + 200×1.25 + 10×5                       = 305
//   codex call 1 terra: 1000×2 + 100×12                            = 3200
//   codex call 2 terra: 1200×2 + 1000×0.2 + 100×12                 = 3800
//   codex call 3 auto-review → gpt-5.6-luna: 100×0.2 + 10×1.2      = 32
//   fork thr2, own call after the replayed burst, terra: 300×2 + 30×12 = 960
//   fork thr3, single event (no burst), terra, priority tier 2×: (40×2 + 10×12)×2 = 400
const EXPECTED = (9012 + 3308 + 470 + 305 + 3200 + 3800 + 32 + 960 + 400) / 1e6 + 0.02;

test("fixture totals match hand-computed, deduplicated usage", async () => {
  const r = await runAudit(fixtureOptions(), undefined, 1);
  assert.ok(Math.abs(r.billing.total.cost - EXPECTED) < 1e-12, `${r.billing.total.cost} vs ${EXPECTED}`);
  assert.equal(r.calls, 9);
  assert.equal(r.skipped.duplicateCalls, 1, "msg_1 repeated in a resumed session");
  assert.equal(r.skipped.notBillable, 3, "forked thread's replayed burst");
  assert.equal(r.skipped.lines, 2);
  assert.deepEqual(r.sessions, { main: 4, subagent: 1, bySource: { "claude-code": 1, codex: 3 } });
  const bucketCost = r.buckets.reduce((n, b) => n + b.cost, 0);
  assert.ok(Math.abs(bucketCost - r.billing.total.cost) < 1e-12, "buckets add up to the billed total");
});

test("period filter drops calls outside the window", async () => {
  const r = await runAudit(fixtureOptions({ sinceMs: Date.parse("2026-09-21T00:00:00Z") }), undefined, 1);
  assert.equal(r.calls, 2, "only the two forks' own calls on 09-21 and 09-22");
});

test("golden JSON report", async () => {
  const r = await runAudit(fixtureOptions(), undefined, 1);
  const actual = renderJson(r, { showProjects: false, version: "test" });
  const golden = join(FIXTURES, "..", "golden", "report.json");
  if (process.env.UPDATE_GOLDEN || !existsSync(golden)) writeFileSync(golden, actual);
  assert.equal(actual, readFileSync(golden, "utf8"));
});

test("worker pool gives the same result as one thread", async () => {
  const one = await runAudit(fixtureOptions(), undefined, 1);
  const many = await runAudit(fixtureOptions(), new URL("../src/cli.ts", import.meta.url), 3);
  assert.deepEqual(many, one);
});
