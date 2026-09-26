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
import { saverIndex } from "../src/savers/registry.ts";
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
    assert.deepEqual(buckets(split), buckets(adjacent));
    const skill = (r: FileResult) => summarize(fixtureOptions(), [r], { savers: saverIndex(["caveman-skill"]), tools: new Map(), stats: new Map() }).savers;
    assert.deepEqual(skill(split), skill(adjacent), "caveman-skill's re-read credit uses the final output");
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

test("caveman-skill is credited for re-reading only the earlier output the context keeps", async () => {
  await withDir(async (run) => {
    const skill = { ids: ["caveman-skill"], replayable: [] };
    const audit = (r: FileResult) => summarize(fixtureOptions(), [r], { savers: saverIndex(["caveman-skill"]), tools: new Map(), stats: new Map() });
    const row = (r: ReturnType<typeof audit>, key: string) => r.buckets.find((b) => b.key === key) ?? { tokens: 0, cost: 0 };
    // The same session with and without 4,000 thinking tokens per answer: same prompts, same cache numbers.
    const pair = async (model: string) => {
      const a = audit(await run(thinkingSession(model, 20, 15_000, 4000), skill));
      const b = audit(await run(thinkingSession(model, 20, 15_000, 0), skill));
      return { a, b, saved: a.savers[0]!.tokens - b.savers[0]!.tokens, usd: a.savers[0]!.cost - b.savers[0]!.cost, out: row(a, "output").tokens - row(b, "output").tokens, outUsd: row(a, "output").cost - row(b, "output").cost };
    };
    // Dropped at each prompt: the thinking is never re-read, so it adds only the output cut itself.
    const drop = await pair("claude-sonnet-4-5-20250929");
    assert.deepEqual(drop.a.buckets.filter((b) => b.key !== "output"), drop.b.buckets.filter((b) => b.key !== "output"), "same context either way");
    assert.equal(drop.out, 20 * 4000);
    assert.ok(Math.abs(drop.saved - 0.085 * drop.out) < 1e-6, `${drop.saved} vs ${0.085 * drop.out}`);
    assert.ok(Math.abs(drop.usd - 0.085 * drop.outUsd) < 1e-12, `${drop.usd} vs ${0.085 * drop.outUsd}`);
    // Kept: later calls re-read it, and the skill's shorter output is re-read too.
    const keep = await pair("claude-sonnet-4-6");
    assert.ok(row(keep.a, "assistant").tokens > row(keep.b, "assistant").tokens);
    assert.ok(keep.saved > 0.085 * keep.out + 1000, `${keep.saved} vs ${0.085 * keep.out}`);
  });
});

const ts = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const system = (uuid: string, t: string, parentUuid: string) => ({ ...env(uuid, t, parentUuid), type: "system", subtype: "turn_duration", durationMs: 1000 });
const contextMode = { ids: ["context-mode"], replayable: [] };
const saved = (r: FileResult) => summarize(fixtureOptions(), [r], { savers: saverIndex(["context-mode"]), tools: new Map(), stats: new Map() }).savers[0]!.tokens;
const context = (r: FileResult) => r.records.map((x) => ({ key: x.key, oldRaw: x.oldRaw, newRaw: x.newRaw, oldReal: x.oldReal, newReal: x.newReal }));

test("a rewind to the start: the abandoned tool output leaves the context and no saver is credited for it", async () => {
  await withDir(async (run) => {
    const before = [
      prompt("p0", "00:00", "build it", null),
      assistant("m0", "00:01", "msg_0", [bash("t0", "npm run build")], usage(5000, 0, 50), undefined, "p0"),
      toolResult("r0", "00:02", "t0", log(300, "build"), "m0"),
      assistant("m1", "00:03", "msg_1", [text("the build fails")], usage(9000, 5000, 20), undefined, "r0"),
    ];
    // Rewound to the first prompt: the new prompt is a chain root again.
    const after: object[] = [prompt("q0", "01:00", "start over: what does this repo do?", null)];
    for (let i = 0; i < 20; i++) {
      after.push(assistant(`n${i}`, ts(61 + 2 * i), `msg_n${i}`, [text(`answer ${i}`)], usage(20, 5000 + 20 * i, 10), undefined, `q${i}`));
      after.push(prompt(`q${i + 1}`, ts(62 + 2 * i), `follow-up ${i}`, `n${i}`));
    }
    const r = await run([...before, ...after], contextMode);
    const post = r.records.slice(2);
    assert.equal(post.length, 20);
    for (const rec of post) {
      assert.equal(Object.keys({ ...rec.oldRaw, ...rec.newRaw }).some((k) => k.startsWith("tool:")), false, rec.key);
      assert.ok(rec.range!.ctxStart >= 1, "the abandoned output is outside the saver context");
    }
    assert.equal(post[0]!.oldReal + post[0]!.newReal, 0);
    const cut = await run(before, contextMode);
    assert.ok(saved(cut) > 0);
    assert.equal(saved(r), saved(cut), "credited only on the call that saw the build log");
  });
});

test("a rewind to an earlier prompt gives the context of the kept conversation", async () => {
  await withDir(async (run) => {
    // Also on a model that drops thinking at a prompt, so the thinking state is restored too.
    for (const [model, reply] of [
      ["claude-opus-5-5", (c: object) => [c]],
      ["claude-sonnet-4-5-20250929", (c: object) => [think, c]],
    ] as const) {
      const head = [
        prompt("p0", "00:00", "build it", null),
        assistant("m0", "00:01", "msg_0", reply(bash("t0", "npm run build")), usage(5000, 0, 50), model, "p0"),
        toolResult("r0", "00:02", "t0", log(40, "build"), "m0"),
        assistant("m1", "00:03", "msg_1", reply(text("fixed it")), usage(900, 5000, 20), model, "r0"),
      ];
      const abandoned = [
        prompt("p1", "00:04", "now run the tests", "m1"),
        assistant("m2", "00:05", "msg_2", reply(bash("t2", "npm test")), usage(30, 5900, 40), model, "p1"),
        toolResult("r2", "00:06", "t2", log(200, "tests"), "m2"),
        assistant("m3", "00:07", "msg_3", reply(text("tests fail")), usage(3000, 5930, 20), model, "r2"),
      ];
      // p1 is rewound and replaced: p2 takes p1's parent.
      const tail = [
        prompt("p2", "00:08", "instead, update the changelog", "m1"),
        assistant("m4", "00:09", "msg_4", reply(text("done")), usage(40, 5900, 10), model, "p2"),
        prompt("p3", "00:10", "thanks", "m4"),
        assistant("m5", "00:11", "msg_5", reply(text("ok")), usage(20, 5950, 5), model, "p3"),
      ];
      const branched = await run([...head, ...abandoned, ...tail]);
      const linear = await run([...head, ...tail]);
      assert.deepEqual(context(branched).slice(4), context(linear).slice(2), model);
      assert.equal(branched.records[4]!.prev, undefined, "no calibration pair across the branch");
    }
  });
});

/** Per call and saver: the saver's deltas on blocks already in context, and on new ones. */
const credit = (r: FileResult) =>
  r.records.map((x) => {
    const blocks = r.savers!.timelines[x.range!.tl]!.blocks;
    const sum = (a: number, z: number, i: number) => blocks.slice(a, z).reduce((n, b) => n + b.d[i]!, 0);
    return r.savers!.covered.map((_, i) => [sum(x.range!.ctxStart, x.range!.newStart, i), sum(x.range!.newStart, x.range!.newEnd, i)]);
  });

test("after a rewind, savers keep crediting the kept conversation as without the abandoned branch", async () => {
  await withDir(async (run) => {
    const head = [
      prompt("p0", "00:00", "build it", null),
      assistant("m0", "00:01", "msg_0", [bash("t0", "npm run build")], usage(5000, 0, 50), undefined, "p0"),
      toolResult("r0", "00:02", "t0", log(200, "build"), "m0"),
      assistant("m1", "00:03", "msg_1", [text("fixed it")], usage(900, 5000, 20), undefined, "r0"),
    ];
    const abandoned = [
      prompt("p1", "00:04", "now run the tests", "m1"),
      assistant("m2", "00:05", "msg_2", [bash("t2", "npm test")], usage(30, 5900, 40), undefined, "p1"),
      toolResult("r2", "00:06", "t2", log(200, "tests"), "m2"),
      assistant("m3", "00:07", "msg_3", [text("tests fail")], usage(3000, 5930, 20), undefined, "r2"),
    ];
    const tail = [
      prompt("p2", "00:08", "instead, update the changelog", "m1"),
      assistant("m4", "00:09", "msg_4", [text("done")], usage(40, 5900, 10), undefined, "p2"),
      prompt("p3", "00:10", "thanks", "m4"),
      assistant("m5", "00:11", "msg_5", [text("ok")], usage(20, 5950, 5), undefined, "p3"),
    ];
    const branched = await run([...head, ...abandoned, ...tail], contextMode);
    const linear = await run([...head, ...tail], contextMode);
    assert.deepEqual(credit(branched).slice(4), credit(linear).slice(2));
    assert.ok(credit(linear)[2]![0]![0]! > 0, "the kept build log is credited on every later call");
    // Replay results are written to a job's block after the worker's structured clone: the kept copy is the same object.
    const blocks = structuredClone(branched).savers!.timelines.main!.blocks;
    assert.equal(blocks.filter((b) => b === blocks[0]).length, 2);
  });
});

test("an ordinary parentUuid chain, with parallel tool results, is not a rewind", async () => {
  await withDir(async (run) => {
    const rows = (withParents: boolean) => {
      const p = (x: string | null) => (withParents ? x : undefined);
      return [
        prompt("p0", "00:00", "check both", p(null)),
        assistant("a0", "00:01", "msg_0", [bash("t0", "npm test")], usage(5000, 0, 1), undefined, p("p0")),
        assistant("a1", "00:02", "msg_0", [bash("t1", "npm run lint")], usage(5000, 0, 60), undefined, p("a0")),
        toolResult("r0", "00:03", "t0", log(30, "t"), p("a0")),
        toolResult("r1", "00:04", "t1", log(30, "l"), p("a1")),
        assistant("m1", "00:05", "msg_1", [text("both fail")], usage(900, 5000, 20), undefined, p("r1")),
        system("s1", "00:06", "m1"),
        prompt("p1", "00:07", "fix them", p("s1")),
        assistant("m2", "00:08", "msg_2", [text("fixed")], usage(30, 5900, 10), undefined, p("p1")),
        prompt("p2", "00:09", "and commit", p("m2")),
        assistant("m3", "00:10", "msg_3", [text("committed")], usage(30, 5940, 10), undefined, p("p2")),
      ];
    };
    assert.deepEqual(view(await run(rows(true), contextMode)), view(await run(rows(false), contextMode)));
  });
});
