// Regression tests for how Claude Code transcripts become call records. The
// transcripts are synthetic and written to a temp dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processFile, summarize, type FileResult, type SaverConfig } from "../src/audit.ts";
import { fixtureOptions } from "./helpers.ts";

const env = (uuid: string, ts: string, parentUuid?: string | null) => ({
  sessionId: "sess-a1",
  cwd: "/home/dev/SECRET-a1",
  uuid,
  ...(parentUuid !== undefined ? { parentUuid } : {}),
  timestamp: `2026-09-20T10:${ts}.000Z`,
  isSidechain: false,
});
const usage = (cacheWrite: number, cacheRead: number, output: number) => ({ input_tokens: 1, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output });
const prompt = (uuid: string, ts: string, text: string, parentUuid?: string | null) => ({ ...env(uuid, ts, parentUuid), type: "user", message: { role: "user", content: text } });
const assistant = (uuid: string, ts: string, id: string, content: object[], u: object, model = "claude-opus-5-5", parentUuid?: string | null) => ({
  ...env(uuid, ts, parentUuid),
  type: "assistant",
  requestId: `req_${id}`,
  message: { id, role: "assistant", model, content, usage: u },
});
const text = (t: string) => ({ type: "text", text: t });
const bash = (id: string, command: string) => ({ type: "tool_use", id, name: "Bash", input: { command } });
const toolResult = (uuid: string, ts: string, id: string, out: string, parentUuid?: string | null) => ({
  ...env(uuid, ts, parentUuid),
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: out }] },
});
const log = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `FAILED tests/test_${tag}.py::case_${i} - AssertionError: value ${i}`).join("\n");

async function withDir(fn: (run: (rows: object[], savers?: SaverConfig) => Promise<FileResult>) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "sa-a1-"));
  let n = 0;
  try {
    await fn((rows, savers) => {
      const file = join(dir, `t${n++}.jsonl`);
      writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      return processFile(file, "claude-code", 0, savers);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const view = (r: FileResult) => r.records.map((x) => ({ key: x.key, oldRaw: x.oldRaw, newRaw: x.newRaw, oldReal: x.oldReal, newReal: x.newReal, prev: x.prev?.key, range: x.range }));
const buckets = (r: FileResult) => summarize(fixtureOptions(), [r]).buckets;

test("a response split around its tool results keeps its final output count in context", async () => {
  await withDir(async (run) => {
    const p1 = prompt("p1", "00:00", "run the tests", null);
    // msg_1 has two tool_use blocks, one line each; the first carries a placeholder output count.
    const a1 = assistant("a1", "00:01", "msg_1", [bash("t1", "pytest -q")], usage(3000, 0, 1));
    const a2 = assistant("a2", "00:02", "msg_1", [bash("t2", "pytest -q -k slow")], usage(3000, 0, 400));
    const r1 = toolResult("r1", "00:03", "t1", log(40, "a"));
    const r2 = toolResult("r2", "00:04", "t2", log(40, "b"));
    const m2 = assistant("m2", "00:05", "msg_2", [text("done")], usage(900, 3000, 20));
    const p2 = prompt("p2", "00:06", "thanks");
    const m3 = assistant("m3", "00:07", "msg_3", [text("ok")], usage(30, 4300, 5));
    const savers = { ids: ["caveman-skill"], replayable: [] };
    const adjacent = await run([p1, a1, a2, r1, r2, m2, p2, m3], savers);
    const split = await run([p1, a1, r1, a2, r2, m2, p2, m3], savers);
    assert.equal(split.records[1]!.newReal, 400, "msg_2 re-reads msg_1's final output, not the placeholder");
    assert.equal(split.records[2]!.oldReal, 400, "and so does every later call");
    assert.deepEqual(view(split), view(adjacent));
    assert.deepEqual(split.savers!.timelines.main!.blocks, adjacent.savers!.timelines.main!.blocks, "caveman-skill's re-read block uses the final output");
    assert.deepEqual(buckets(split), buckets(adjacent));
  });
});
