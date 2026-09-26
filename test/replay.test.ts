import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResult } from "../src/audit.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { runReplays, type ReplayTool } from "../src/savers/replay.ts";
import { replayKey } from "../src/savers/tracker.ts";
import { SAVERS } from "../src/savers/registry.ts";
import type { ReplayJob } from "../src/savers/types.ts";

const BIN = fileURLToPath(new URL("./fixtures/bin/", import.meta.url));

type Spec = Partial<ReplayJob> & { key: string; input: string };

/** One synthetic log file whose outputs are replay jobs for `saver` (the saver at index 0). */
function synth(saver: string, specs: Spec[]): FileResult {
  const jobs = specs.map((s, i): ReplayJob => ({ saver, tool: "Bash", cls: "Shell|tests", baseline: countProxy(s.input), headerTokens: 0, addTokens: 0, timeline: "main", block: i, ...s }));
  return { file: "f", source: "claude-code", records: [], skippedLines: 0, savers: { timelines: { main: { blocks: jobs.map(() => ({ d: [0], r: [0] })) } }, jobs, covered: [0], toolTokens: 0 } };
}

const deltas = (f: FileResult) => f.savers!.timelines.main!.blocks.map((b) => b.d[0]!);
const tool = (saver: string, command: string, env?: Record<string, string>): Map<string, ReplayTool> => new Map([[saver, { saver, command: join(BIN, command), env }]]);
const text = (i: number, chars = 4000) => `${i} ${"line of test output\n".repeat(Math.ceil(chars / 20))}`.slice(0, chars);

function tmp(): { dir: string; cacheFile: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sa-replay-"));
  return { dir, cacheFile: join(dir, "replay.json"), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a failed replay is never cached: once the saver works, the next run measures it", async () => {
  const t = tmp();
  try {
    const specs = [0, 1, 2].map((i) => ({ key: `k${i}`, input: text(i) }));
    const broken = synth("caveman-engine", specs);
    const a = (await runReplays([broken], ["caveman-engine"], { tools: tool("caveman-engine", "fake-saver", { FAKE_FAIL: "1" }), cacheFile: t.cacheFile, full: true, concurrency: 2 })).get("caveman-engine")!;
    assert.equal(a.failed, 3);
    assert.deepEqual(deltas(broken), [0, 0, 0], "a failed output counts as unchanged in its own run");
    const saved = existsSync(t.cacheFile) ? Object.keys(JSON.parse(readFileSync(t.cacheFile, "utf8")).entries) : [];
    assert.deepEqual(saved, [], "nothing about a failed run is written to the cache");
    const fixed = synth("caveman-engine", specs);
    const b = (await runReplays([fixed], ["caveman-engine"], { tools: tool("caveman-engine", "fake-saver"), cacheFile: t.cacheFile, full: true, concurrency: 2 })).get("caveman-engine")!;
    assert.equal(b.ran, 3, "replayed again, not served from a cached failure");
    assert.equal(b.failed, 0);
    assert.ok(deltas(fixed).every((d) => d > 0));
  } finally {
    t.done();
  }
});

test("replay keys: headroom keeps its cached results; per-process savers drop records that may hold failures", () => {
  const legacy = (id: string, version: string) => createHash("sha256").update(`${id}@${version}\0Bash\0\0`).update("out").digest("base64url").slice(0, 32);
  const byId = new Map(SAVERS.map((s) => [s.id, s]));
  const headroom = byId.get("headroom")!;
  assert.equal(replayKey(headroom, "Bash", undefined, "out"), legacy("headroom", headroom.version), "hours of headroom replays stay valid");
  for (const id of ["rtk", "caveman-engine", "token-saver", "lean-ctx"]) {
    const s = byId.get(id)!;
    assert.notEqual(replayKey(s, "Bash", undefined, "out"), legacy(id, s.version), id);
  }
});

test("headroom without its cached model: every output failed, no number, the reason instead", async () => {
  const t = tmp();
  try {
    const f = synth("headroom", [0, 1, 2].map((i) => ({ key: `h${i}`, input: text(i) })));
    const st = (await runReplays([f], ["headroom"], { tools: tool("headroom", "fake-headroom", { FAKE_READY: "0" }), cacheFile: t.cacheFile, full: true, concurrency: 1 })).get("headroom")!;
    assert.deepEqual({ failed: st.failed, pending: st.pending, insufficient: st.insufficient, reason: st.reason }, { failed: 3, pending: 0, insufficient: true, reason: "compression model not cached" });
    assert.deepEqual(deltas(f), [0, 0, 0]);
  } finally {
    t.done();
  }
});

test("a sidecar that exits mid-run fails the rest instead of hanging", async () => {
  const t = tmp();
  try {
    const f = synth("headroom", [0, 1, 2, 3, 4].map((i) => ({ key: `h${i}`, input: text(i) })));
    const st = (await runReplays([f], ["headroom"], { tools: tool("headroom", "fake-headroom", { FAKE_DIE_AFTER: "2" }), cacheFile: t.cacheFile, full: true, concurrency: 1 })).get("headroom")!;
    assert.equal(st.ran, 5);
    assert.equal(st.failed, 3);
    assert.equal(st.insufficient, true, "more failed than measured");
    assert.equal(st.reason, "most replays failed");
  } finally {
    t.done();
  }
});
