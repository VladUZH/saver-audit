// Regression tests for how Claude Code transcripts become call records. The
// transcripts are synthetic and written to a temp dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processFile, summarize, type FileResult, type SaverConfig } from "../src/audit.ts";
import { dropsThinking } from "../src/accounting/buckets.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { attachmentText } from "../src/sources/claude-code.ts";
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
const attachment = (uuid: string, ts: string, a: object) => ({ ...env(uuid, ts), type: "attachment", attachment: a });
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

test("attached images and PDFs: the base64 payload is not counted as prompt text", async () => {
  const b64 = "iVBORw0KGgo" + "A".repeat(200_000);
  const image = { type: "file", filename: "shot.png", content: { type: "image", file: { base64: b64, type: "image/png", originalSize: 150_000, dimensions: { originalWidth: 800, originalHeight: 600 } } } };
  const pdf = { type: "file", filename: "spec.pdf", content: { type: "pdf", file: { filePath: "/x/spec.pdf", base64: b64, originalSize: 150_000 } } };
  const block = { type: "hook_additional_context", content: [{ type: "text", text: "see image" }, { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }] };
  assert.equal(attachmentText(image), "");
  assert.equal(attachmentText(pdf), "");
  assert.equal(attachmentText(block), "see image");
  const textFile = { type: "file", filename: "a.ts", content: { type: "text", file: { filePath: "/x/a.ts", content: "export const a = 1;", numLines: 1 } } };
  assert.equal(attachmentText(textFile), "export const a = 1;", "text files still count");

  await withDir(async (run) => {
    const rows = (withImage: boolean) => [
      prompt("p1", "00:00", "what is in this screenshot", null),
      ...(withImage ? [attachment("at1", "00:00", image)] : []),
      ...Array.from({ length: 5 }, (_, i) => [
        assistant(`m${i}`, `0${i}:01`, `msg_${i}`, [bash(`t${i}`, "pytest -q")], usage(2000, 1000 * i, 50)),
        toolResult(`r${i}`, `0${i}:02`, `t${i}`, log(30, `r${i}`)),
      ]).flat(),
      assistant("m9", "09:01", "msg_9", [text("done")], usage(100, 9000, 20)),
    ];
    const plain = await run(rows(false));
    const attached = await run(rows(true));
    assert.deepEqual(view(attached), view(plain));
    assert.deepEqual(buckets(attached), buckets(plain));
  });
});

const think = { type: "thinking", thinking: "", signature: "c2lnbmF0dXJl" };
const answer = (i: number) => `Answer ${i}: ` + Array.from({ length: 40 }, (_, j) => `the build step ${j} passes after the fix`).join(", ");

/** n prompts, each answered by one response with thinking; the prompt grows by the visible text only. */
function thinkingSession(model: string, n: number, system: number, thinkTokens: number): object[] {
  const rows: object[] = [];
  let before = 0;
  let prevVisible = 0;
  for (let i = 0; i < n; i++) {
    const q = `question ${i}: does the build pass now?`;
    const write = (i === 0 ? system : 0) + countProxy(q) + prevVisible;
    rows.push(prompt(`p${i}`, `${10 + i}:00`, q, i === 0 ? null : `m${i - 1}`));
    rows.push(assistant(`m${i}`, `${10 + i}:01`, `msg_${i}`, [think, text(answer(i))], usage(write, before, thinkTokens + countProxy(answer(i))), model, `p${i}`));
    before += write;
    prevVisible = countProxy(answer(i));
  }
  return rows;
}

test("older Claude models drop earlier thinking at each new prompt", async () => {
  for (const m of ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001", "claude-opus-4-1-20250805", "claude-opus-4-20250514", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-3-7-sonnet-20250219"]) {
    assert.equal(dropsThinking(m), true, m);
  }
  for (const m of ["claude-opus-4-5", "claude-sonnet-4-6", "claude-opus-5-5", "claude-sonnet-5", "claude-fable-5", "claude-mythos-1", "claude-haiku-5", "gpt-5.6-terra", "claude-next"]) {
    assert.equal(dropsThinking(m), false, m);
  }

  await withDir(async (run) => {
    const system = 15_000;
    const r = await run(thinkingSession("claude-sonnet-4-5-20250929", 10, system, 4000));
    const vis = Array.from({ length: 10 }, (_, i) => countProxy(answer(i)));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    r.records.slice(1).forEach((rec, j) => {
      const i = j + 1;
      assert.equal(rec.oldReal + rec.newReal, 0, `call ${i}: no earlier output with thinking left`);
      assert.equal(rec.newRaw.assistant, vis[i - 1], `call ${i}: the previous answer's visible text is new`);
      assert.equal(rec.oldRaw.assistant ?? 0, sum(vis.slice(0, i - 1)));
      assert.equal(rec.prev, undefined, "no calibration pair across dropped thinking");
    });
    const rows = buckets(r);
    const residual = rows.find((b) => b.key === "residual")!;
    assert.ok(Math.abs(residual.tokens - 10 * (system + 1)) < 1e-6, `residual is the system prompt on every call: ${residual.tokens}`);
    const reread = rows.find((b) => b.key === "assistant")!;
    const expected = sum(vis.map((_, i) => sum(vis.slice(0, i))));
    assert.ok(Math.abs(reread.tokens - expected) < 1e-6, `${reread.tokens} vs ${expected}`);

    const keep = await run(thinkingSession("claude-sonnet-4-6", 10, system, 4000));
    assert.equal(keep.records[2]!.oldReal, 4000 + vis[0]!, "keep-all models still re-read earlier thinking");
  });
});

test("within a tool loop thinking stays; a logged thinking count drops only that part", async () => {
  await withDir(async (run) => {
    const model = "claude-sonnet-4-5-20250929";
    const loop = await run([
      prompt("p0", "00:00", "fix the build", null),
      assistant("m0", "00:01", "msg_0", [think, bash("t0", "npm run build")], usage(5000, 0, 3000), model),
      toolResult("r0", "00:02", "t0", log(20, "b")),
      assistant("m1", "00:03", "msg_1", [think, bash("t1", "npm test")], usage(400, 5000, 2000), model),
      toolResult("r1", "00:04", "t1", log(1, "c")),
      assistant("m2", "00:05", "msg_2", [text("done")], usage(100, 5400, 20), model),
    ]);
    assert.deepEqual(loop.records.map((x) => [x.oldReal, x.newReal]), [[0, 0], [0, 3000], [3000, 2000]]);

    const counted = await run([
      prompt("p0", "00:00", "fix the build", null),
      assistant("m0", "00:01", "msg_0", [think, text("fixed")], { ...usage(5000, 0, 4200), output_tokens_details: { thinking_tokens: 4000 } }, model),
      prompt("p1", "00:02", "thanks, commit it"),
      assistant("m1", "00:03", "msg_1", [text("ok")], usage(300, 5000, 20), model),
    ]);
    assert.equal(counted.records[1]!.newReal, 200, "visible part of the earlier output, in recorded tokens");
    assert.equal(counted.records[1]!.newRaw.assistant, undefined);
  });
});
