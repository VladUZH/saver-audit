import { test } from "node:test";
import assert from "node:assert/strict";
import { attribute, callCost, RESIDUAL } from "../src/accounting/cost.ts";
import type { CallRecord } from "../src/accounting/buckets.ts";
import { BUNDLED } from "../src/prices/load.ts";
import { ratesFor, resolveModel } from "../src/prices/table.ts";
import { emptyUsage } from "../src/sources/types.ts";

// data/prices.json itself, not a table --update-prices saved on this machine.
const prices = BUNDLED;

test("model resolution: [1m] suffix, dated ids, codex-auto-review by date", () => {
  assert.equal(resolveModel(prices, "claude-opus-5[1m]"), "claude-opus-5");
  assert.equal(resolveModel(prices, "claude-haiku-4-5-20251001"), "claude-haiku-4-5-20251001");
  assert.equal(resolveModel(prices, "codex-auto-review", "2026-07-01T00:00:00Z"), "gpt-5.4");
  assert.equal(resolveModel(prices, "codex-auto-review", "2026-09-01T00:00:00Z"), "gpt-5.6-luna");
  assert.equal(resolveModel(prices, "gpt-5.1-codex-mini"), "gpt-5.1-codex-mini", "retired model from LiteLLM");
  assert.equal(resolveModel(prices, "made-up-model"), undefined);
});

test("bundled prices match the official list checked on 2026-09-25 (tech-notes §5)", () => {
  assert.deepEqual(prices.models["claude-opus-5-5"], { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 });
  assert.deepEqual(prices.models["claude-fable-5-1"], { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5, cacheWrite1h: 20 });
  const terra = prices.models["gpt-5.6-terra"]!;
  assert.deepEqual([terra.input, terra.cacheRead, terra.output], [2, 0.2, 12]);
  assert.equal(ratesFor(terra, 300_000).input, 4, "above-272k tier");
});

test("call cost: 5m vs 1h cache writes, multiplier, web search fee", () => {
  const u = { ...emptyUsage(), input: 3, cacheWrite: 1000, cacheWrite1h: 400, cacheRead: 2000, output: 50, webSearches: 2 };
  const c = callCost(u, prices.models["claude-opus-5-5"]!, 1);
  // 3×4 + (600×5 + 400×8) + 2000×0.2 + 50×20, per 1M tokens
  assert.ok(Math.abs(c.input - 12e-6) < 1e-12);
  assert.ok(Math.abs(c.cacheWrite - 6200e-6) < 1e-12);
  assert.ok(Math.abs(c.cacheRead - 400e-6) < 1e-12);
  assert.ok(Math.abs(c.output - 1000e-6) < 1e-12);
  assert.equal(c.webSearch, 0.02);
  assert.ok(Math.abs(callCost(u, prices.models["claude-opus-5-5"]!, 2).output - 2000e-6) < 1e-12);
});

function rec(over: Partial<CallRecord>, usage: Partial<ReturnType<typeof emptyUsage>>): CallRecord {
  return { key: "k", model: "claude-opus-5-5", call: { key: "k", model: "claude-opus-5-5", usage: { ...emptyUsage(), ...usage }, multiplier: 1, billable: true }, file: 0, oldRaw: {}, newRaw: {}, oldReal: 0, newReal: 0, proxyAppended: 0, ...over };
}

test("attribution splits exactly the prompt cost, old content first into cache reads", () => {
  const r = rec({ oldRaw: { "tool:Shell|tests": 600 }, oldReal: 200, newRaw: { prompt: 100 } }, { input: 10, cacheWrite: 190, cacheRead: 1000 });
  const c = callCost(r.call.usage, prices.models["claude-opus-5-5"]!, 1);
  const shares = attribute(r, 1, c);
  const sum = [...shares.values()].reduce((a, s) => ({ tokens: a.tokens + s.tokens, cost: a.cost + s.cost }), { tokens: 0, cost: 0 });
  assert.ok(Math.abs(sum.tokens - 1200) < 1e-9);
  assert.ok(Math.abs(sum.cost - (c.input + c.cacheWrite + c.cacheRead)) < 1e-12);
  // 800 old tokens all fit in the 1000 cache-read tokens: priced at the read rate.
  assert.ok(Math.abs(shares.get("tool:Shell|tests")!.cost - 600 * 0.2e-6) < 1e-12);
  assert.ok(Math.abs(shares.get(RESIDUAL)!.tokens - 300) < 1e-9);
});

test("attribution scales estimates down when they exceed the recorded prompt", () => {
  const r = rec({ newRaw: { prompt: 5000 } }, { input: 0, cacheWrite: 1000, cacheRead: 0 });
  const c = callCost(r.call.usage, prices.models["claude-opus-5-5"]!, 1);
  const shares = attribute(r, 1, c);
  assert.ok(Math.abs(shares.get("prompt")!.tokens - 1000) < 1e-9);
  assert.equal(shares.get(RESIDUAL)!.tokens, 0);
});
