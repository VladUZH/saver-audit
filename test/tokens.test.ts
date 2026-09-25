import { test } from "node:test";
import assert from "node:assert/strict";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { calibrate, countProxy, theilSen, tokenizerFamily } from "../src/accounting/tokens.ts";

test("countProxy handles special-token strings and long runs", () => {
  assert.ok(countProxy("hi <|endoftext|> there") > 3);
  const blob = "A".repeat(50_000);
  const n = countProxy(`start ${blob} end`);
  assert.ok(n > 0 && n < 50_000);
  const normal = "The quick brown fox jumps over the lazy dog. ".repeat(200);
  assert.equal(countProxy(normal), countTokens(normal), "ordinary text is counted exactly");
});

test("theilSen recovers slope and intercept despite outliers", () => {
  const pts: Array<[number, number]> = [];
  for (let x = 200; x < 20000; x += 97) pts.push([x, 1.5 * x + 500]);
  for (let i = 0; i < 20; i++) pts.push([1000 + i * 50, 50]); // outliers
  const { k, c } = theilSen(pts);
  assert.ok(Math.abs(k - 1.5) < 0.02, `k=${k}`);
  assert.ok(Math.abs(c - 500) < 60, `c=${c}`);
});

test("calibrate: per model, family fallback, OpenAI fixed at 1", () => {
  const pairs = [];
  for (let i = 0; i < 40; i++) pairs.push({ model: "claude-opus-5-5", proxy: 300 + i * 100, appended: 1.6 * (300 + i * 100) + 20 });
  for (let i = 0; i < 5; i++) pairs.push({ model: "claude-sonnet-5", proxy: 400 + i * 100, appended: 1.6 * (400 + i * 100) });
  const cal = calibrate(pairs, ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5", "gpt-5.6-sol"]);
  assert.equal(cal.get("claude-opus-5-5")!.basis, "model");
  assert.ok(Math.abs(cal.get("claude-opus-5-5")!.k - 1.6) < 0.01);
  assert.equal(cal.get("claude-sonnet-5")!.basis, "family");
  assert.equal(cal.get("claude-haiku-4-5")!.basis, "none");
  assert.equal(cal.get("gpt-5.6-sol")!.k, 1);
  assert.equal(tokenizerFamily("claude-opus-4-6"), "claude ≤4.6 tokenizer");
  assert.equal(tokenizerFamily("claude-opus-4-7"), "claude 4.7+ tokenizer");
  assert.equal(tokenizerFamily("claude-fable-5-1"), "claude 4.7+ tokenizer");
});
