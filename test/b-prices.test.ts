import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import snapshot from "../data/prices.json" with { type: "json" };
import { runAudit } from "../src/pool.ts";
import { BUNDLED, userPricesPath } from "../src/prices/load.ts";
import { resolveModel } from "../src/prices/table.ts";
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
