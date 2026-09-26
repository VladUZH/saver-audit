import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { processFile, summarize } from "../src/audit.ts";
import { renderTerminal } from "../src/report/terminal.ts";
import { codexHome, codexUsage, findCodexFiles, parseCodexFile, shellCommand } from "../src/sources/codex.ts";
import { shellFamily, toolCategory } from "../src/accounting/categories.ts";
import { CODEX_HOME, collect, fixtureOptions } from "./helpers.ts";

const thr1 = join(CODEX_HOME, "sessions", "2026", "09", "20", "rollout-2026-09-20T10-00-00-thr1.jsonl");
const thr2 = join(CODEX_HOME, "sessions", "2026", "09", "21", "rollout-2026-09-21T08-00-00-thr2.jsonl");

test("CODEX_HOME: empty means unset, relative is made absolute", () => {
  const saved = process.env.CODEX_HOME;
  try {
    for (const v of ["", "  "]) {
      process.env.CODEX_HOME = v;
      assert.equal(codexHome(), join(homedir(), ".codex"));
    }
    process.env.CODEX_HOME = "rel/codex";
    assert.equal(codexHome(), join(process.cwd(), "rel", "codex"));
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved;
  }
});

test("finder prefers sessions/ over an archived copy", () => {
  const files = findCodexFiles(CODEX_HOME, 0);
  assert.equal(files.length, 3);
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

test("base instructions are marked as sent with every request; nothing else is", async () => {
  const ev = await collect(parseCodexFile(thr1));
  const users = ev.flatMap((e) => (e.t === "turn" && e.turn.role === "user" ? [e.turn] : []));
  assert.deepEqual(users.map((t) => t.resent === true), [true, false, false, false, false, false]);
  assert.equal(users[0]!.userKind, "system");
  // So the call after the compaction still has them in context.
  const recs = (await processFile(thr1, "codex", 0)).records;
  assert.equal(recs.length, 3);
  assert.ok((recs[2]!.oldRaw.system ?? 0) > 0, "base instructions in context after the compaction");
});

test("forked threads: the replayed burst is not billed, the thread's own usage is", async () => {
  const ev = await collect(parseCodexFile(thr2));
  const calls = ev.flatMap((e) => (e.t === "turn" && e.turn.call ? [e.turn.call] : []));
  assert.deepEqual(calls.map((c) => c.billable), [false, false, false, true]);
});

test("a fork with a single usage event had no burst and is billed", async () => {
  const ev = await collect(parseCodexFile(join(CODEX_HOME, "sessions", "2026", "09", "22", "rollout-2026-09-22T08-00-00-thr3.jsonl")));
  const calls = ev.flatMap((e) => (e.t === "turn" && e.turn.call ? [e.turn.call] : []));
  assert.deepEqual(calls.map((c) => c.billable), [true]);
});

test("a fork replaying a single parent event: that event is not billed, the fork's own call is", async () => {
  const ev = await collect(parseCodexFile(join(CODEX_HOME, "cases", "rollout-fork-one-replayed.jsonl")));
  const calls = ev.flatMap((e) => (e.t === "turn" && e.turn.call ? [e.turn.call] : []));
  assert.deepEqual(calls.map((c) => c.billable), [false, true]);
  assert.deepEqual(calls.map((c) => c.usage.input), [100000, 1000]);
  // A search in the replayed history stays on the unbilled replayed call.
  assert.deepEqual(calls.map((c) => c.webSearchCalls), [1, undefined]);
});

test("web_search_call items are counted on the next call and not priced as Claude searches", async () => {
  const ev = await collect(parseCodexFile(join(CODEX_HOME, "cases", "rollout-web-search.jsonl")));
  const calls = ev.flatMap((e) => (e.t === "turn" && e.turn.call ? [e.turn.call] : []));
  assert.equal(calls.length, 3, "the re-emitted token_count is skipped");
  assert.deepEqual(calls.map((c) => c.webSearchCalls), [2, 1, undefined]);
  assert.deepEqual(calls.map((c) => c.usage.webSearches), [0, 0, 0]);
  assert.equal(ev.some((e) => e.t === "turn" && JSON.stringify(e.turn).includes("SECRET-QUERY")), false, "queries are not kept");
});

test("Codex web searches: billed calls' searches are counted, said to be unpriced, and not in the total", async () => {
  const opts = fixtureOptions({ sources: ["codex"] });
  const r = summarize(opts, [await processFile(join(CODEX_HOME, "cases", "rollout-web-search.jsonl"), "codex", 0)]);
  assert.deepEqual(r.billing.webSearch, { requests: 0, cost: 0, unpriced: 3 });
  const b = r.billing;
  assert.equal(b.total.cost, b.input.cost + b.cacheWrite.cost + b.cacheRead.cost + b.output.cost, "no search fee in the total");
  const text = renderTerminal(r, { showProjects: false, color: false, verbose: false });
  assert.match(text, /Codex web searches \(3\)\s+not priced \(no OpenAI per-search fee in the price list\)/);
  assert.match(text, /Codex web search fees are not in the total/);
  assert.doesNotMatch(text, /SECRET/);
  // A search in a fork's replayed history was billed in the parent: not counted here.
  const fork = summarize(opts, [await processFile(join(CODEX_HOME, "cases", "rollout-fork-one-replayed.jsonl"), "codex", 0)]);
  assert.equal(fork.billing.webSearch.unpriced, 0);
  assert.doesNotMatch(renderTerminal(fork, { showProjects: false, color: false, verbose: false }), /web search/i);
});

test("codexUsage and shellCommand edge cases", () => {
  assert.deepEqual(codexUsage(null).input, 0);
  assert.equal(codexUsage({ input_tokens: 10, cached_input_tokens: 50, output_tokens: 1 }).cacheRead, 10, "cached capped at input");
  assert.equal(shellCommand("exec", "tools.exec_command({'cmd': 'ls -la'})"), "ls -la");
  assert.equal(shellCommand("exec", "const x = 1;"), "");
  assert.equal(shellCommand("shell", { command: ["bash", "-lc", "cargo test"] }), "cargo test");
  assert.equal(shellCommand("apply_patch", "*** Begin Patch"), undefined);
});

test("exec: an unclosed cmd string with many escapes returns quickly", () => {
  const input = 'await tools.exec_command({cmd: "cat <<EOF\\n' + "line\\n".repeat(22) + "EOF";
  const t = performance.now();
  assert.equal(shellCommand("exec", input), "");
  assert.ok(performance.now() - t < 250, "no catastrophic backtracking");
  assert.equal(shellCommand("exec", 'tools.exec_command({cmd: "echo \\"hi\\" && ls"})'), 'echo \\"hi\\" && ls');
  assert.equal(shellCommand("exec", "tools.exec_command({cmd: 'a\\'b'})"), "a\\'b");
});

test("shell_command (string command) is a shell tool", () => {
  const cmd = shellCommand("shell_command", { command: "rg -n compute src", workdir: "/x" });
  assert.equal(cmd, "rg -n compute src");
  assert.equal(shellFamily(cmd!), "search");
  assert.equal(toolCategory("shell_command"), "Shell");
});
