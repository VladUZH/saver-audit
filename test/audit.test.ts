import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/pool.ts";
import { renderJson } from "../src/report/json.ts";
import { renderTerminal } from "../src/report/terminal.ts";
import { CLAUDE_ROOT, FAKE_TOOLS, FIXTURES, fixtureOptions } from "./helpers.ts";

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

test("calls on an unpriced model keep their tokens in the context split and in saver counts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-unpriced-"));
  try {
    // The Claude fixture with every model renamed to one the price table lacks.
    const root = join(dir, "projects");
    cpSync(CLAUDE_ROOT, root, { recursive: true });
    for (const f of readdirSync(root, { recursive: true, encoding: "utf8" }).filter((x) => x.endsWith(".jsonl"))) {
      const p = join(root, f);
      writeFileSync(p, readFileSync(p, "utf8").replace(/"model":"claude-[^"]*"/g, '"model":"claude-zeta-1"'));
    }
    const r = await runAudit(fixtureOptions({ sources: ["claude-code"], claudeRoots: [root] }), undefined, 1, { ids: ["rtk"], tools: new Map([["rtk", FAKE_TOOLS.get("rtk")!]]), cacheFile: join(dir, "c.json"), full: true });
    assert.deepEqual(r.models.map((m) => [m.model, m.pricedAs]), [["claude-zeta-1", undefined]]);
    assert.equal(r.billing.total.cost, 0);
    const tokens = r.buckets.reduce((n, b) => n + b.tokens, 0);
    assert.ok(Math.abs(tokens - r.billing.total.tokens) < 1e-6 * r.billing.total.tokens, `context split ${tokens} of ${r.billing.total.tokens} billed tokens`);
    assert.ok(r.buckets.some((b) => b.key.startsWith("tool:") && b.tokens > 0), "tool output is in the split");
    const rtk = r.savers.find((s) => s.id === "rtk")!;
    assert.ok(rtk.tokens > 0, "rtk's tokens are counted");
    assert.equal(rtk.cost, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a model priced as two models (an alias that changed on a date) gets a row for each", async () => {
  const home = mkdtempSync(join(tmpdir(), "sa-alias-"));
  try {
    // codex-auto-review is gpt-5.4 before 2026-07-29 and gpt-5.6-luna after.
    const rollout = (day: string, calls: number) => {
      const dir = join(home, "sessions", ...day.split("-"));
      mkdirSync(dir, { recursive: true });
      const ev = (ms: number, type: string, payload: object) => JSON.stringify({ timestamp: new Date(Date.parse(`${day}T10:00:00Z`) + ms).toISOString(), type, payload });
      const lines = [ev(0, "session_meta", { id: `t-${day}`, cwd: "/tmp/p", originator: "codex-tui", cli_version: "0.146.0", source: "cli", model_provider: "openai" }), ev(100, "turn_context", { model: "codex-auto-review" })];
      for (let i = 1; i <= calls; i++) {
        const last = { input_tokens: 100, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 };
        const total = { ...last, input_tokens: 100 * i, output_tokens: 10 * i, total_tokens: 110 * i };
        lines.push(ev(i * 5000, "event_msg", { type: "token_count", info: { total_token_usage: total, last_token_usage: last } }));
      }
      writeFileSync(join(dir, `rollout-${day}T10-00-00-t.jsonl`), lines.join("\n") + "\n");
    };
    rollout("2026-07-20", 1);
    rollout("2026-08-10", 5);
    const r = await runAudit(fixtureOptions({ sources: ["codex"], codexHome: home, sinceMs: Date.parse("2026-07-01T00:00:00Z") }), undefined, 1);
    assert.deepEqual(r.models.map((m) => [m.model, m.pricedAs, m.calls]).sort(), [["codex-auto-review", "gpt-5.4", 1], ["codex-auto-review", "gpt-5.6-luna", 5]]);
    const full = renderTerminal(r, { showProjects: false, verbose: false, color: false });
    assert.match(full, /^Models: codex-auto-review$/m);
    assert.match(full, /Priced as: codex-auto-review → gpt-5\.4 \(1 call\) \/ gpt-5\.6-luna \(5 calls\) \(no public price\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
