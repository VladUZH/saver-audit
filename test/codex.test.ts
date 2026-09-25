import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { codexUsage, findCodexFiles, parseCodexFile, shellCommand } from "../src/sources/codex.ts";
import { CODEX_HOME, collect } from "./helpers.ts";

const thr1 = join(CODEX_HOME, "sessions", "2026", "09", "20", "rollout-2026-09-20T10-00-00-thr1.jsonl");
const thr2 = join(CODEX_HOME, "sessions", "2026", "09", "21", "rollout-2026-09-21T08-00-00-thr2.jsonl");

test("finder prefers sessions/ over an archived copy", () => {
  const files = findCodexFiles(CODEX_HOME, 0);
  assert.equal(files.length, 2);
  assert.equal(files.some((f) => f.includes("archived_sessions")), false);
});

test("token_count: repeats and null info are skipped; cached is converted to Claude semantics", async () => {
  const ev = await collect(parseCodexFile(thr1));
  const calls = ev.flatMap((e) => (e.t === "turn" && e.turn.call ? [e.turn.call] : []));
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.model), ["gpt-5.6-terra", "gpt-5.6-terra", "codex-auto-review"]);
  assert.deepEqual(calls[1]!.usage, { input: 1200, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 1000, output: 100, reasoning: 0, webSearches: 0 });
  assert.equal(calls[0]!.usage.reasoning, 40);
  assert.equal(ev.filter((e) => e.t === "skip").length, 1);
  assert.equal(ev.filter((e) => e.t === "compact").length, 1);
});

test("tool outputs are labelled with the tool and a shell family", async () => {
  const ev = await collect(parseCodexFile(thr1));
  const results = ev.flatMap((e) => (e.t === "turn" ? e.turn.blocks : [])).filter((b) => b.kind === "tool_result");
  assert.deepEqual(results.map((b) => b.kind === "tool_result" && [b.tool, b.family]), [["exec", "git"], ["exec_command", "tests"]]);
  const kinds = ev.flatMap((e) => (e.t === "turn" && e.turn.role === "user" ? [e.turn.userKind] : []));
  assert.deepEqual(kinds, ["system", "injected", "prompt", "tool-results", "tool-results", "compaction-summary"]);
});

test("forked threads bill only after their own first turn", async () => {
  const ev = await collect(parseCodexFile(thr2));
  const calls = ev.flatMap((e) => (e.t === "turn" && e.turn.call ? [e.turn.call] : []));
  assert.deepEqual(calls.map((c) => c.billable), [false, true]);
});

test("codexUsage and shellCommand edge cases", () => {
  assert.deepEqual(codexUsage(null).input, 0);
  assert.equal(codexUsage({ input_tokens: 10, cached_input_tokens: 50, output_tokens: 1 }).cacheRead, 10, "cached capped at input");
  assert.equal(shellCommand("exec", "tools.exec_command({'cmd': 'ls -la'})"), "ls -la");
  assert.equal(shellCommand("exec", "const x = 1;"), "");
  assert.equal(shellCommand("shell", { command: ["bash", "-lc", "cargo test"] }), "cargo test");
  assert.equal(shellCommand("apply_patch", "*** Begin Patch"), undefined);
});
