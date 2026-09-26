import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResult } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { runReplays, type ReplayTool } from "../src/savers/replay.ts";
import { replayKey } from "../src/savers/tracker.ts";
import { SAVERS } from "../src/savers/registry.ts";
import type { ReplayJob } from "../src/savers/types.ts";
import { FAKE_TOOLS, fixtureOptions } from "./helpers.ts";

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

/** A folder this process cannot write to (undefined when running as root, where chmod does not stop writes). */
function readOnlyDir(parent: string): string | undefined {
  const ro = join(parent, "ro");
  mkdirSync(ro);
  chmodSync(ro, 0o555);
  try {
    writeFileSync(join(ro, "probe"), "");
    return undefined;
  } catch {
    return ro;
  }
}

test("an unwritable replay cache warns once and the replay still finishes", async (c) => {
  const t = tmp();
  try {
    const ro = readOnlyDir(t.dir);
    if (!ro) return c.skip("running as root");
    const logs: string[] = [];
    // headroom's sidecar is fast enough to pass the 250-output checkpoint.
    const f = synth("headroom", Array.from({ length: 260 }, (_, i) => ({ key: `h${i}`, input: text(i, 400) })));
    const st = (await runReplays([f], ["headroom"], { tools: tool("headroom", "fake-headroom"), cacheFile: join(ro, "sa", "replay.json"), full: true, concurrency: 1, log: (s) => logs.push(s) })).get("headroom")!;
    assert.equal(st.ran, 260);
    assert.ok(deltas(f).every((d) => d > 0), "results still used in this run");
    assert.equal(logs.filter((l) => l.startsWith("replay cache not saved (EACCES)")).length, 1, logs.join("\n"));
  } finally {
    chmodSync(join(t.dir, "ro"), 0o755);
    t.done();
  }
});

test("an unwritable cache folder or temp folder never aborts the audit", async (c) => {
  const t = tmp();
  const oldTmp = process.env.TMPDIR;
  try {
    const ro = readOnlyDir(t.dir);
    if (!ro) return c.skip("running as root");
    const r = await runAudit(fixtureOptions(), undefined, 1, { ids: ["rtk", "codegraph"], tools: FAKE_TOOLS, cacheFile: join(ro, "sa", "replay.json"), full: true });
    assert.ok(r.savers.find((s) => s.id === "rtk")!.cost > 0);
    process.env.TMPDIR = join(t.dir, "missing");
    const none = await runAudit(fixtureOptions(), undefined, 1, { ids: ["rtk", "codegraph"], tools: new Map() });
    assert.equal(none.savers.find((s) => s.id === "codegraph")!.status, "ok", "no replayed saver installed: no temp folder needed");
    const some = await runAudit(fixtureOptions(), undefined, 1, { ids: ["rtk"], tools: FAKE_TOOLS, cacheFile: join(t.dir, "c.json"), full: true });
    const rtk = some.savers.find((s) => s.id === "rtk")!.replay!;
    assert.deepEqual({ insufficient: rtk.insufficient, reason: rtk.reason }, { insufficient: true, reason: "no temporary folder" });
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = oldTmp;
    chmodSync(join(t.dir, "ro"), 0o755);
    t.done();
  }
});

async function gone(pid: number): Promise<boolean> {
  for (let n = 0; n < 40; n++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test("an error during replay closes the headroom sidecar", async () => {
  const t = tmp();
  try {
    const pidFile = join(t.dir, "pid");
    const f = synth("headroom", [0, 1, 2].map((i) => ({ key: `h${i}`, input: text(i) })));
    const boom = () => {
      throw new Error("stop");
    };
    await assert.rejects(runReplays([f], ["headroom"], { tools: tool("headroom", "fake-headroom", { FAKE_PIDFILE: pidFile }), cacheFile: t.cacheFile, full: true, concurrency: 1, progress: boom }), /stop/);
    assert.ok(await gone(Number(readFileSync(pidFile, "utf8"))), "sidecar still running");
  } finally {
    t.done();
  }
});

test("an error during replay stops the other workers and leaves no saver state behind", async () => {
  const t = tmp();
  const oldTmp = process.env.TMPDIR;
  try {
    const temp = join(t.dir, "tmp");
    mkdirSync(temp);
    process.env.TMPDIR = temp;
    const runs = join(t.dir, "runs");
    // The first output is quick and its progress report fails; the others are slow.
    const specs = Array.from({ length: 20 }, (_, i) => ({ key: `k${String(i).padStart(2, "0")}`, input: `${i === 0 ? "" : "SLOW "}${text(i, 1000 + 100 * (20 - i))}` }));
    const f = synth("caveman-engine", specs);
    const boom = () => {
      throw new Error("stop");
    };
    const env = { FAKE_SLEEP_MS: "300", FAKE_STATE: "1", FAKE_LOG: runs };
    await assert.rejects(runReplays([f], ["caveman-engine"], { tools: tool("caveman-engine", "fake-saver", env), cacheFile: t.cacheFile, full: true, concurrency: 4, progress: boom }), /stop/);
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(readFileSync(runs, "utf8").split("\n").filter(Boolean).length, 4, "only the outputs already started");
    assert.deepEqual(readdirSync(temp), [], "state folder removed after the last saver process ended");
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = oldTmp;
    t.done();
  }
});

test("a replay the OS refuses to start (argument too long, NUL byte) counts as failed", async () => {
  const t = tmp();
  try {
    const specs: Spec[] = [0, 1, 2, 3, 4].map((i) => ({ key: `k${i}`, input: text(i), args: ["compress"] }));
    specs[1]!.args = ["compress", "x".repeat(2_000_000)]; // over ARG_MAX (macOS) and MAX_ARG_STRLEN (Linux)
    specs[3]!.args = ["compress", "a\0b"];
    const f = synth("caveman-engine", specs);
    const st = (await runReplays([f], ["caveman-engine"], { tools: tool("caveman-engine", "fake-saver"), cacheFile: t.cacheFile, full: true, concurrency: 2 })).get("caveman-engine")!;
    assert.deepEqual({ ran: st.ran, failed: st.failed, insufficient: st.insufficient }, { ran: 5, failed: 2, insufficient: undefined });
    const d = deltas(f);
    assert.deepEqual([d[1], d[3]], [0, 0]);
    assert.ok([d[0], d[2], d[4]].every((x) => x! > 0));
  } finally {
    t.done();
  }
});
