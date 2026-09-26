import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import snapshot from "../data/prices.json" with { type: "json" };
import { runAudit } from "../src/pool.ts";
import { BUNDLED, loadPrices, userPricesPath } from "../src/prices/load.ts";
import { resolveModel } from "../src/prices/table.ts";
import { LITELLM_URL, updatePrices } from "../src/prices/update.ts";
import { fixtureOptions } from "./helpers.ts";

/** A temp XDG cache dir holding `table` where --update-prices saves it. */
function savedTable(table: object): string {
  const dir = mkdtempSync(join(tmpdir(), "sa-b-"));
  mkdirSync(join(dir, "saver-audit"));
  writeFileSync(join(dir, "saver-audit", "prices.json"), JSON.stringify(table));
  return dir;
}

/** Audits a synthetic Claude Code session with one assistant call per entry. */
async function auditClaude(calls: Array<{ model: string; usage: object }>) {
  const root = mkdtempSync(join(tmpdir(), "sa-b-claude-"));
  mkdirSync(join(root, "-tmp-p"));
  const line = (o: object) => JSON.stringify({ sessionId: "s", cwd: "/tmp/p", timestamp: "2026-09-20T10:00:00.000Z", ...o });
  const lines = [line({ uuid: "u0", type: "user", message: { role: "user", content: "hi" } })];
  calls.forEach((c, i) => lines.push(line({ uuid: `a${i}`, type: "assistant", requestId: `req_${i}`, message: { id: `msg_${i}`, role: "assistant", model: c.model, content: [{ type: "text", text: "ok" }], usage: c.usage } })));
  writeFileSync(join(root, "-tmp-p", "s.jsonl"), lines.join("\n") + "\n");
  return runAudit(fixtureOptions({ sources: ["claude-code"], claudeRoots: [root] }), undefined, 1);
}

test("test fixtures price with data/prices.json, not a table --update-prices saved on this machine", () => {
  const newer = { ...snapshot, date: "2999-01-01", models: { ...snapshot.models, "claude-opus-5-5": { ...snapshot.models["claude-opus-5-5"], input: 99 } } };
  process.env.XDG_CACHE_HOME = savedTable(newer);
  const prices = fixtureOptions().prices;
  assert.equal(prices.date, snapshot.date);
  assert.equal(prices.models["claude-opus-5-5"]!.input, snapshot.models["claude-opus-5-5"].input);
});

test("an empty or relative XDG_CACHE_HOME falls back to ~/.cache, never the current directory", () => {
  const saved = process.env.XDG_CACHE_HOME;
  try {
    for (const x of ["", "rel", "./rel"]) {
      process.env.XDG_CACHE_HOME = x;
      assert.equal(userPricesPath(), join(homedir(), ".cache", "saver-audit", "prices.json"), JSON.stringify(x));
    }
    process.env.XDG_CACHE_HOME = join(tmpdir(), "xdg");
    assert.equal(userPricesPath(), join(tmpdir(), "xdg", "saver-audit", "prices.json"));
    assert.ok(isAbsolute(userPricesPath()));
  } finally {
    if (saved === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = saved;
  }
});

test("model names that are Object.prototype keys are unpriced, not a crash", async () => {
  for (const m of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "valueOf-20250101"]) {
    assert.equal(resolveModel(BUNDLED, m), undefined, m);
  }
  const r = await auditClaude([{ model: "constructor", usage: { input_tokens: 10, output_tokens: 5 } }]);
  assert.deepEqual(r.models.map((m) => [m.model, m.pricedAs, m.cost]), [["constructor", undefined, 0]]);
});

test("OpenAI dated snapshot ids price as their base model; listed snapshots keep their own price", () => {
  assert.equal(resolveModel(BUNDLED, "gpt-5-2025-08-07"), "gpt-5");
  assert.equal(resolveModel(BUNDLED, "gpt-5.1-2025-11-13"), "gpt-5.1");
  assert.equal(resolveModel(BUNDLED, "gpt-4.1-2025-04-14"), "gpt-4.1");
  assert.equal(resolveModel(BUNDLED, "o3-2025-04-16"), "o3");
  assert.equal(resolveModel(BUNDLED, "openai/gpt-5-2025-08-07"), "gpt-5");
  assert.equal(resolveModel(BUNDLED, "gpt-4o-2024-05-13"), "gpt-4o-2024-05-13");
  assert.equal(resolveModel(BUNDLED, "gpt-5-2025-08"), undefined, "not a full date");
});

test("a table saved by --update-prices overlays the bundled one: dropped models keep their price, aliases come from this version", () => {
  const models: Record<string, unknown> = { ...snapshot.models, "claude-opus-5-5": { ...snapshot.models["claude-opus-5-5"], input: 3 } };
  for (const id of ["gpt-5.4", "gpt-5.1-codex", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929"]) delete models[id];
  const dir = savedTable({ date: "2999-01-01", sources: ["https://models.dev/api.json (MIT)"], models, aliases: {} });
  const t = loadPrices(join(dir, "saver-audit", "prices.json"));
  assert.equal(t.date, "2999-01-01");
  assert.equal(t.models["claude-opus-5-5"]!.input, 3, "fresh price wins");
  assert.equal(resolveModel(t, "gpt-5.1-codex"), "gpt-5.1-codex");
  assert.equal(resolveModel(t, "claude-sonnet-4-5-20250929"), "claude-sonnet-4-5-20250929");
  assert.equal(resolveModel(t, "codex-auto-review", "2026-07-15T00:00:00Z"), "gpt-5.4", "alias and its target survive");
  assert.deepEqual(t.sources, ["https://models.dev/api.json (MIT)", `bundled snapshot of ${snapshot.date} for 4 models the update lacks`]);
});

test("--update-prices with a failed LiteLLM fetch warns, does not list LiteLLM, and keeps retired Codex prices", async () => {
  const cost = { input: 2, output: 12, cache_read: 0.2, cache_write: 2.5 };
  const modelsDev = { anthropic: { models: {} }, openai: { models: { "gpt-5.6-terra": { cost } } } };
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url) === LITELLM_URL) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(modelsDev));
  }) as typeof fetch;
  const log: string[] = [];
  const target = join(mkdtempSync(join(tmpdir(), "sa-b-up-")), "saver-audit", "prices.json");
  try {
    const saved = await updatePrices(target, (s) => log.push(s));
    assert.deepEqual(saved.sources, ["https://models.dev/api.json (MIT)"]);
  } finally {
    globalThis.fetch = real;
  }
  assert.ok(log.some((l) => l.includes("LiteLLM fetch failed (fetch failed)")), log.join("\n"));
  const t = loadPrices(target);
  for (const id of ["gpt-5-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5.1-codex-max", "gpt-5.2-codex"]) {
    assert.deepEqual(t.models[id], BUNDLED.models[id], id);
  }
});
