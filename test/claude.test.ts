import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { findClaudeFiles, parseClaudeFile } from "../src/sources/claude-code.ts";
import { CLAUDE_ROOT, collect } from "./helpers.ts";

const main = join(CLAUDE_ROOT, "-home-dev-SECRET-project-alpha", "sess-1.jsonl");

test("finder skips .orphaned- copies and includes subagent transcripts", () => {
  const files = findClaudeFiles([CLAUDE_ROOT, join(CLAUDE_ROOT, "missing")], 0).map((f) => f.slice(CLAUDE_ROOT.length));
  assert.equal(files.some((f) => f.includes("orphaned")), false);
  assert.equal(files.some((f) => f.includes("/subagents/agent-a1.jsonl")), true);
  assert.equal(files.length, 3);
});

test("merges the lines of one response and keeps the max usage per field", async () => {
  const ev = await collect(parseClaudeFile(main));
  const calls = ev.flatMap((e) => (e.t === "turn" && e.turn.call ? [e.turn] : []));
  assert.deepEqual(calls.map((t) => t.call!.key), ["msg_1|req_1", "msg_2|req_2", "msg_3|req_3"]);
  const [first, second, third] = calls;
  assert.equal(first!.blocks.length, 2, "text + tool_use merged into one turn");
  assert.equal(first!.call!.usage.output, 50, "placeholder output replaced");
  assert.equal(first!.call!.usage.cacheWrite1h, 1000);
  assert.equal(second!.call!.usage.output, 30, "later non-adjacent copy raised output");
  assert.equal(third!.call!.usage.webSearches, 2);
});

test("labels tool results, counts attachments, skips bad lines, marks compaction", async () => {
  const ev = await collect(parseClaudeFile(main));
  const results = ev.flatMap((e) => (e.t === "turn" ? e.turn.blocks : [])).filter((b) => b.kind === "tool_result");
  assert.equal(results.length, 1);
  assert.equal(results[0]!.kind === "tool_result" && results[0]!.tool, "Bash");
  assert.equal(results[0]!.kind === "tool_result" && results[0]!.family, "tests");
  const kinds = ev.flatMap((e) => (e.t === "turn" && e.turn.role === "user" ? [e.turn.userKind] : []));
  assert.deepEqual(kinds, ["prompt", "tool-results", "injected", "compaction-summary"], "prompt_snapshot attachment not counted");
  assert.equal(ev.filter((e) => e.t === "skip").length, 1);
  assert.equal(ev.filter((e) => e.t === "compact").length, 1);
  assert.equal(ev.some((e) => e.t === "turn" && e.turn.call?.model === "<synthetic>"), false);
});

test("session metadata: project is the cwd basename; subagent files are flagged", async () => {
  const [s] = await collect(parseClaudeFile(main));
  assert.equal(s!.t === "session" && s!.session.project, "SECRET-project-alpha");
  const sub = await collect(parseClaudeFile(join(CLAUDE_ROOT, "-home-dev-SECRET-project-alpha", "sess-1", "subagents", "agent-a1.jsonl")));
  assert.equal(sub[0]!.t === "session" && sub[0]!.session.isSubagent, true);
});
