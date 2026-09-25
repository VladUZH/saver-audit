// Writes the synthetic fixture logs. Everything here is made up; strings containing
// SECRET must never appear in any report (test/privacy.test.ts).
//   node test/fixtures/build.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const jsonl = (rows) => rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";
const write = (rel, rows) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, jsonl(rows));
};

// A tool output long enough to pass the calibration minimum (200 o200k tokens).
const longOutput = Array.from({ length: 60 }, (_, i) => `FAILED tests/test_SECRET_module.py::test_case_${i} - AssertionError: SECRET-TOOL-OUTPUT value ${i}`).join("\n");

const env = (extra) => ({ sessionId: "sess-1", cwd: "/home/dev/SECRET-project-alpha", version: "2.1.282", userType: "external", entrypoint: "cli", isSidechain: false, gitBranch: "main", ...extra });
const usage = (input, cw, cw1h, cr, out, web = 0) => ({
  input_tokens: input,
  cache_creation_input_tokens: cw,
  cache_creation: { ephemeral_5m_input_tokens: cw - cw1h, ephemeral_1h_input_tokens: cw1h },
  cache_read_input_tokens: cr,
  output_tokens: out,
  server_tool_use: { web_search_requests: web, web_fetch_requests: 0 },
  service_tier: "standard",
  speed: "standard",
});
const assistant = (uuid, ts, id, req, model, content, u) => ({ ...env({ uuid, timestamp: ts }), type: "assistant", requestId: req, message: { id, type: "message", role: "assistant", model, content: [content], stop_reason: null, usage: u } });

// --- Claude Code: main session ---
write("claude/projects/-home-dev-SECRET-project-alpha/sess-1.jsonl", [
  { ...env({ uuid: "u1", parentUuid: null, timestamp: "2026-09-20T10:00:00.000Z" }), type: "user", message: { role: "user", content: "SECRET-PROMPT: please run the tests in /home/dev/SECRET-project-alpha" } },
  // One API response written as two lines (text, then tool_use); output is a placeholder on the first.
  assistant("a1", "2026-09-20T10:00:05.000Z", "msg_1", "req_1", "claude-opus-5-5", { type: "text", text: "SECRET-ASSISTANT-TEXT running tests" }, usage(3, 1000, 1000, 0, 1)),
  assistant("a2", "2026-09-20T10:00:06.000Z", "msg_1", "req_1", "claude-opus-5-5", { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "cd /home/dev/SECRET-project-alpha && pytest -q", description: "SECRET run" } }, usage(3, 1000, 1000, 0, 50)),
  { ...env({ uuid: "u2", timestamp: "2026-09-20T10:00:10.000Z" }), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: longOutput, is_error: true }] }, toolUseResult: { stdout: longOutput, stderr: "", interrupted: false, isImage: false } },
  { ...env({ uuid: "at1", timestamp: "2026-09-20T10:00:10.500Z" }), type: "attachment", attachment: { type: "total_tokens_reminder", content: "SECRET-REMINDER tokens left" } },
  { ...env({ uuid: "at2", timestamp: "2026-09-20T10:00:10.600Z" }), type: "attachment", attachment: { type: "prompt_snapshot", content: "SECRET-SNAPSHOT not counted" } },
  assistant("a3", "2026-09-20T10:00:15.000Z", "msg_2", "req_2", "claude-opus-5-5", { type: "text", text: "SECRET-ASSISTANT-TEXT two" }, usage(2, 500, 0, 1000, 20)),
  { type: "brand-new-record-type", payload: "SECRET-UNKNOWN" },
  '{"type":"user","message":{"role":"user","content":"SECRET-TRUNCATED',
  { ...env({ uuid: "sys1", timestamp: "2026-09-20T10:01:00.000Z" }), type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 3000, postTokens: 400 } },
  // Non-adjacent copy of msg_2 with the final output count: the max wins.
  assistant("a3b", "2026-09-20T10:00:15.500Z", "msg_2", "req_2", "claude-opus-5-5", { type: "text", text: "SECRET-ASSISTANT-TEXT two" }, usage(2, 500, 0, 1000, 30)),
  { ...env({ uuid: "u3", timestamp: "2026-09-20T10:01:01.000Z" }), type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: "user", content: "SECRET-SUMMARY of the conversation so far" } },
  assistant("a4", "2026-09-20T10:01:10.000Z", "msg_3", "req_3", "claude-sonnet-5", { type: "text", text: "SECRET-ASSISTANT-TEXT three" }, usage(10, 0, 0, 2000, 5, 2)),
  { ...env({ uuid: "a5", timestamp: "2026-09-20T10:01:11.000Z" }), type: "assistant", isApiErrorMessage: true, message: { id: "msg_syn", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "SECRET-ERROR" }], usage: usage(0, 0, 0, 0, 0) } },
]);

// Subagent transcript.
write("claude/projects/-home-dev-SECRET-project-alpha/sess-1/subagents/agent-a1.jsonl", [
  { ...env({ uuid: "s1", isSidechain: true, agentId: "a1", timestamp: "2026-09-20T10:00:20.000Z" }), type: "user", message: { role: "user", content: "SECRET-SUBAGENT-TASK" } },
  { ...assistant("s2", "2026-09-20T10:00:25.000Z", "msg_4", "req_4", "claude-haiku-4-5-20251001", { type: "text", text: "SECRET-SUBAGENT-TEXT" }, usage(5, 200, 0, 0, 10)), isSidechain: true, agentId: "a1" },
]);

// A resumed session file that repeats msg_1: deduplicated.
write("claude/projects/-home-dev-SECRET-project-beta/sess-2.jsonl", [
  { ...env({ sessionId: "sess-2", cwd: "/home/dev/SECRET-project-beta", uuid: "b1", timestamp: "2026-09-21T09:00:00.000Z" }), type: "user", message: { role: "user", content: "SECRET-PROMPT-BETA" } },
  { ...assistant("b2", "2026-09-20T10:00:06.000Z", "msg_1", "req_1", "claude-opus-5-5", { type: "text", text: "SECRET-COPY" }, usage(3, 1000, 1000, 0, 50)), sessionId: "sess-2", cwd: "/home/dev/SECRET-project-beta" },
]);

// A set-aside transcript: skipped by name.
write("claude/projects/-home-dev-SECRET-project-alpha/sess-1.orphaned-1758000000-x.jsonl", [
  assistant("o1", "2026-09-20T10:00:06.000Z", "msg_orphan", "req_o", "claude-opus-5-5", { type: "text", text: "SECRET-ORPHAN" }, usage(1, 1_000_000, 0, 0, 1)),
]);

// --- Codex ---
const tc = (ts, total, last) => ({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: total === null ? null : { total_token_usage: { ...last, total_tokens: total }, last_token_usage: { ...last, total_tokens: last.input_tokens + last.output_tokens }, model_context_window: 272000 } } });
const u = (input, cached, output, reasoning = 0) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning });

write("codex/sessions/2026/09/20/rollout-2026-09-20T10-00-00-thr1.jsonl", [
  { timestamp: "2026-09-20T10:00:00.000Z", type: "session_meta", payload: { id: "thr1", cwd: "/home/dev/SECRET-codex-proj", originator: "codex-tui", cli_version: "0.146.0", source: "cli", model_provider: "openai", base_instructions: { text: "SECRET-BASE-INSTRUCTIONS you are a coding agent" } } },
  { timestamp: "2026-09-20T10:00:00.100Z", type: "turn_context", payload: { model: "gpt-5.6-terra", effort: "medium", cwd: "/home/dev/SECRET-codex-proj" } },
  { timestamp: "2026-09-20T10:00:00.200Z", type: "event_msg", payload: { type: "task_started" } },
  { timestamp: "2026-09-20T10:00:00.300Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>SECRET-ENV</environment_context>" }] } },
  { timestamp: "2026-09-20T10:00:00.400Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "SECRET-CODEX-PROMPT fix the build" }] } },
  { timestamp: "2026-09-20T10:00:01.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "c1", input: 'const r = await tools.exec_command({cmd: "git status --short SECRET-dir"});\nconsole.log(r);' } },
  tc("2026-09-20T10:00:01.100Z", 1100, u(1000, 0, 100, 40)),
  tc("2026-09-20T10:00:01.200Z", 1100, u(1000, 0, 100, 40)), // re-emitted: skipped
  { timestamp: "2026-09-20T10:00:02.000Z", type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", output: "Exit code: 0\nWall time: 0.1 seconds\nOutput:\n M SECRET-FILE.ts" } },
  { timestamp: "2026-09-20T10:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c2", arguments: JSON.stringify({ cmd: "npm test -- SECRET" }) } },
  tc("2026-09-20T10:00:03.100Z", 3400, u(2200, 1000, 100)),
  tc("2026-09-20T10:00:03.200Z", null, null), // info: null (rate-limit update)
  { timestamp: "2026-09-20T10:00:04.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: [{ type: "input_text", text: "SECRET-TEST-OUTPUT all passed" }] } },
  { timestamp: "2026-09-20T10:00:05.000Z", type: "compacted", payload: { message: "SECRET-CODEX-SUMMARY", replacement_history: [{ type: "message", role: "user", content: [{ type: "input_text", text: "SECRET-KEPT" }] }] } },
  { timestamp: "2026-09-20T10:00:05.100Z", type: "turn_context", payload: { model: "codex-auto-review" } },
  tc("2026-09-20T10:00:06.000Z", 3510, u(100, 0, 10)),
  "not json SECRET-BAD-LINE",
]);

// Archived copy of the same rollout: the sessions/ copy wins.
write("codex/archived_sessions/rollout-2026-09-20T10-00-00-thr1.jsonl", [
  { timestamp: "2026-09-20T10:00:00.000Z", type: "session_meta", payload: { id: "thr1-archived", cwd: "/home/dev/SECRET-codex-proj" } },
  { timestamp: "2026-09-20T10:00:00.100Z", type: "turn_context", payload: { model: "gpt-5.6-terra" } },
  tc("2026-09-20T10:00:01.100Z", 999999, u(999999, 0, 0)),
]);

// Forked thread: replayed parent history is not billed again.
write("codex/sessions/2026/09/21/rollout-2026-09-21T08-00-00-thr2.jsonl", [
  { timestamp: "2026-09-21T08:00:00.000Z", type: "session_meta", payload: { id: "thr2", forked_from_id: "thr1", cwd: "/home/dev/SECRET-codex-proj" } },
  { timestamp: "2026-09-21T08:00:00.100Z", type: "turn_context", payload: { model: "gpt-5.6-terra" } },
  tc("2026-09-21T08:00:00.200Z", 5000, u(5000, 0, 0)),
  { timestamp: "2026-09-21T08:00:01.000Z", type: "event_msg", payload: { type: "task_started" } },
  tc("2026-09-21T08:00:02.000Z", 5330, u(300, 0, 30)),
]);

console.log("fixtures written under", root);
