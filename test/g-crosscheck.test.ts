// scripts/crosscheck-usage.mjs: a row whose reference is 0 matches only a 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/crosscheck-usage.mjs", import.meta.url));

// Runs the script in a temporary folder: a synthetic Claude log with 10M uncached input
// tokens and no cache writes, and a stand-in dist/cli.js that reports `cacheWrite`
// cache-write tokens on top. Never reads real logs.
function crosscheck(cacheWrite: number) {
  const dir = mkdtempSync(join(tmpdir(), "saver-audit-crosscheck-"));
  try {
    mkdirSync(join(dir, "claude", "projects", "p"), { recursive: true });
    mkdirSync(join(dir, "codex"));
    mkdirSync(join(dir, "dist"));
    const usage = { input_tokens: 10_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1000 };
    const line = { type: "assistant", timestamp: new Date(Date.now() - 60_000).toISOString(), requestId: "req_1", message: { id: "msg_1", model: "claude-opus-5-5", usage } };
    writeFileSync(join(dir, "claude", "projects", "p", "s.jsonl"), `${JSON.stringify(line)}\n`);
    const billing = { input: { tokens: 10_000_000 }, cacheWrite: { tokens: cacheWrite }, cacheRead: { tokens: 0 }, output: { tokens: 1000 }, total: { tokens: 10_001_000 + cacheWrite } };
    writeFileSync(join(dir, "dist", "cli.js"), `process.stdout.write(${JSON.stringify(JSON.stringify({ billing }))});\n`);
    return spawnSync(process.execPath, [SCRIPT, "30"], { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: join(dir, "claude"), CODEX_HOME: join(dir, "codex") } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("crosscheck fails when saver-audit reports tokens the reference says don't exist", () => {
  // 50k cache writes are 0.5% of the total, so only the cache-write row can catch them.
  const r = crosscheck(50_000);
  assert.match(r.stdout, /cache write\s+reference\s+0\s+saver-audit\s+50000\s+diff n\/a \(reference 0\)/);
  assert.match(r.stdout, /FAIL/);
  assert.equal(r.status, 1);
});

test("crosscheck passes when both sides report 0 for a row", () => {
  const r = crosscheck(0);
  assert.match(r.stdout, /cache write\s+reference\s+0\s+saver-audit\s+0\s+diff 0\.000%/);
  assert.match(r.stdout, /PASS/);
  assert.equal(r.status, 0);
});
