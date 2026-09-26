import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResult } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { detectReplayTools, isOutdated, runReplays, type ReplayTool } from "../src/savers/replay.ts";
import { replayKey } from "../src/savers/tracker.ts";
import { SAVERS } from "../src/savers/registry.ts";
import type { ReplayJob } from "../src/savers/types.ts";
import { FAKE_TOOLS, fixtureOptions } from "./helpers.ts";
import { withEnv } from "./env.ts";

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

test("warnings reach their own channel even when progress lines are not shown (a spinner)", async (c) => {
  const t = tmp();
  try {
    const ro = readOnlyDir(t.dir);
    if (!ro) return c.skip("running as root");
    const warnings: string[] = [];
    const f = synth("headroom", [0, 1].map((i) => ({ key: `h${i}`, input: text(i) })));
    await runReplays([f], ["headroom"], { tools: tool("headroom", "fake-headroom"), cacheFile: join(ro, "replay.json"), full: true, concurrency: 1, warn: (s) => warnings.push(s) });
    assert.deepEqual(warnings, ["replay cache not saved (EACCES); these outputs will be replayed again next run."]);
    const g = synth("headroom", [2].map((i) => ({ key: `h${i}`, input: text(i) })));
    await runReplays([g], ["headroom"], { tools: tool("headroom", "fake-headroom", { FAKE_READY: "0" }), cacheFile: t.cacheFile, full: true, concurrency: 1, warn: (s) => warnings.push(s) });
    assert.match(warnings.at(-1)!, /^headroom: its compression model is not cached/);
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

test("Ctrl+C during a replay removes the savers' state folder (copies of tool output) and still exits", async () => {
  const t = tmp();
  try {
    const temp = join(t.dir, "tmp");
    mkdirSync(temp);
    const script = `
      import { runReplays } from ${JSON.stringify(new URL("../src/savers/replay.ts", import.meta.url).href)};
      const jobs = [0, 1].map((i) => ({ saver: "caveman-engine", key: "k" + i, tool: "Bash", cls: "c", baseline: 100, headerTokens: 0, addTokens: 0, timeline: "main", block: i, input: i + " SLOW tool output", args: [] }));
      const f = { file: "f", source: "claude-code", records: [], skippedLines: 0, savers: { timelines: { main: { blocks: jobs.map(() => ({ d: [0], r: [0] })) } }, jobs, covered: [0], toolTokens: 0 } };
      const tools = new Map([["caveman-engine", { saver: "caveman-engine", command: ${JSON.stringify(join(BIN, "fake-saver"))}, env: { FAKE_SLEEP_MS: "30000", FAKE_STATE: "1" } }]]);
      await runReplays([f], ["caveman-engine"], { tools, full: true, concurrency: 2 });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TMPDIR: temp }, stdio: "ignore" });
    const exited = new Promise<NodeJS.Signals | null>((r) => child.on("exit", (_code, sig) => r(sig)));
    const stored = () => readdirSync(temp).some((d) => existsSync(join(temp, d, "caveman", "ccr.db")));
    for (let n = 0; n < 200 && !stored(); n++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(stored(), "the fake saver wrote its state");
    child.kill("SIGINT");
    assert.equal(await exited, "SIGINT", "ends as interrupted");
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(readdirSync(temp), []);
  } finally {
    t.done();
  }
});

test("quick mode announces replays only for savers it replays (not the cache-only ones)", async () => {
  const t = tmp();
  try {
    const logs: string[] = [];
    await runAudit(fixtureOptions(), undefined, 1, { ids: ["rtk", "caveman-engine", "headroom"], tools: FAKE_TOOLS, cacheFile: t.cacheFile, log: (s) => logs.push(s) });
    assert.ok(logs.some((l) => /^replaying \d+ new outputs through rtk/.test(l)), logs.join("\n"));
    assert.deepEqual(logs.filter((l) => /through (caveman-engine|headroom)/.test(l)), []);
  } finally {
    t.done();
  }
});

// headroom is cache-only in quick mode (quick budget 100: the 50 largest outputs, then a
// hash-order stratum of 50 smaller ones) and its fake sidecar is fast, so it stands in for
// any saver whose quick run extrapolates from what an exact run cached.
const HEADROOM = tool("headroom", "fake-headroom", { FAKE_MIN_CHARS: "2500" });
const exactRun = (f: FileResult, cacheFile: string, progress?: () => void) => runReplays([f], ["headroom"], { tools: HEADROOM, cacheFile, full: true, concurrency: 1, progress });
const quickRun = (f: FileResult, cacheFile: string) => runReplays([f], ["headroom"], { tools: HEADROOM, cacheFile, full: false, concurrency: 1 });
const total = (f: FileResult) => deltas(f).reduce((a, b) => a + b, 0);

test("quick mode: no measured small output means no number, not zeros for the rest", async () => {
  const t = tmp();
  try {
    const specs = Array.from({ length: 200 }, (_, i) => ({ key: `k${String(i).padStart(3, "0")}`, input: text(i, i < 50 ? 5000 : 3000) }));
    await exactRun(synth("headroom", specs.slice(0, 50)), t.cacheFile); // only the 50 largest were ever replayed
    const f = synth("headroom", specs);
    const st = (await quickRun(f, t.cacheFile)).get("headroom")!;
    assert.deepEqual({ insufficient: st.insufficient, reason: st.reason, extrapolated: st.extrapolated }, { insufficient: true, reason: "too few outputs replayed in quick mode", extrapolated: 0 });
  } finally {
    t.done();
  }
});

test("quick mode: when every output is among the largest, the unmeasured ones get the measured ones' ratio, never 0", async () => {
  const t = tmp();
  try {
    const specs = Array.from({ length: 40 }, (_, i) => ({ key: `k${String(i).padStart(3, "0")}`, input: text(i, 3000) }));
    await exactRun(synth("headroom", specs.slice(0, 25)), t.cacheFile); // 15 new outputs since the exact run
    const f = synth("headroom", specs);
    const st = (await quickRun(f, t.cacheFile)).get("headroom")!;
    assert.equal(st.insufficient, undefined);
    assert.equal(st.extrapolated, 15, "the note counts what was written");
    assert.ok(deltas(f).every((d) => d > 0), "no output silently left at 0");
  } finally {
    t.done();
  }
});

test("an interrupted exact run leaves a sample quick mode can extrapolate from without size bias", async () => {
  const t = tmp();
  try {
    // Sizes cycle with the key, so size and hash order are independent; the saver only
    // shrinks outputs of 2,500+ chars, so savings are skewed to the larger outputs.
    const size = [5000, 3000, 2000, 1000];
    const specs = Array.from({ length: 200 }, (_, i) => ({ key: `k${String(i).padStart(3, "0")}`, input: text(i, size[i % 4]!) }));
    const truth = synth("headroom", specs);
    await exactRun(truth, join(t.dir, "full.json"));
    let n = 0;
    const interrupt = () => {
      if (++n === 100) throw new Error("Ctrl+C");
    };
    await assert.rejects(exactRun(synth("headroom", specs), t.cacheFile, interrupt), /Ctrl\+C/);
    const f = synth("headroom", specs);
    const st = (await quickRun(f, t.cacheFile)).get("headroom")!;
    assert.equal(st.insufficient, undefined);
    assert.equal(st.extrapolated, 100);
    const off = total(f) / total(truth) - 1;
    assert.ok(Math.abs(off) < 0.05, `quick is ${(100 * off).toFixed(1)}% off the exact total`);
  } finally {
    t.done();
  }
});

// A Claude <persisted-output> preview: the model saw ~2 KB, the (tool-stage) saver gets the full output.
const PREVIEW = { persistedHeader: "<persisted-output>\nOutput too large. Preview (first 2KB):\n", headerTokens: 12, baseline: 500 };

test("a persisted-output preview never sets the ratio other outputs are extrapolated with", async () => {
  const t = tmp();
  try {
    const ordinary = Array.from({ length: 120 }, (_, i) => ({ key: `k${String(i).padStart(3, "0")}`, input: text(i, 2600 + ((i * 37) % 800)) }));
    // Their full outputs shrink to ~29,000 chars: under the inline limit, so all of it would be sent.
    const previews = [0, 1, 2, 3, 4].map((i) => ({ key: `a${i}`, input: text(i, 116_000), ...PREVIEW }));
    await exactRun(synth("headroom", [...previews, ...ordinary.slice(0, 100)]), t.cacheFile); // 20 outputs are new since
    const f = synth("headroom", [...previews, ...ordinary]);
    const st = (await quickRun(f, t.cacheFile)).get("headroom")!;
    assert.equal(st.extrapolated, 20);
    const d = deltas(f);
    assert.ok(d.slice(0, 5).every((x) => x < 0), "a preview's own measured effect stays (all of it sent inline)");
    assert.ok(d.slice(-20).every((x) => x > 0), "a saver that only shrinks never gets a negative estimate");
  } finally {
    t.done();
  }
});

test("an unmeasured persisted-output preview is not estimated from preview tokens: no number", async () => {
  const t = tmp();
  try {
    const ordinary = Array.from({ length: 100 }, (_, i) => ({ key: `k${String(i).padStart(3, "0")}`, input: text(i, 3000) }));
    await exactRun(synth("headroom", ordinary), t.cacheFile); // enough to extrapolate ordinary outputs from
    const f = synth("headroom", [{ key: "a0", input: text(0, 116_000), ...PREVIEW }, ...ordinary]);
    const st = (await quickRun(f, t.cacheFile)).get("headroom")!;
    assert.deepEqual({ insufficient: st.insufficient, extrapolated: st.extrapolated }, { insufficient: true, extrapolated: 0 });
    assert.equal(deltas(f)[0], 0);
  } finally {
    t.done();
  }
});

test("an upgraded saver is measured again; a matching install keeps its cached results", async () => {
  const rtk = SAVERS.find((s) => s.id === "rtk")!;
  assert.equal(replayKey(rtk, "Bash", "pytest", "out", rtk.version), replayKey(rtk, "Bash", "pytest", "out"), "installed = adapter version: same key");
  assert.notEqual(replayKey(rtk, "Bash", "pytest", "out", "0.51.0"), replayKey(rtk, "Bash", "pytest", "out"));
  const t = tmp();
  try {
    const run = async (version: string) => {
      const tools = new Map([["rtk", { ...FAKE_TOOLS.get("rtk")!, version }]]);
      const r = await runAudit(fixtureOptions(), undefined, 1, { ids: ["rtk"], tools, cacheFile: t.cacheFile, full: true });
      return r.savers.find((s) => s.id === "rtk")!.replay!.ran;
    };
    assert.ok((await run(rtk.version)) > 0);
    assert.equal(await run(rtk.version), 0, "same install: served from the cache");
    assert.ok((await run("0.51.0")) > 0, "upgraded: replayed again");
    assert.equal(await run("0.51.0"), 0);
  } finally {
    t.done();
  }
});

test("quick mode does not extrapolate from a cache that holds only the larger outputs (an older exact run, stopped)", async () => {
  const t = tmp();
  try {
    const size = [5000, 3000, 2000, 1000];
    const specs = Array.from({ length: 200 }, (_, i) => ({ key: `k${String(i).padStart(3, "0")}`, input: text(i, size[i % 4]!) }));
    // Older releases replayed largest first: stopped after 150, the 150 largest are cached.
    await exactRun(synth("headroom", specs.filter((_, i) => i % 4 !== 3)), t.cacheFile);
    const f = synth("headroom", specs);
    const st = (await quickRun(f, t.cacheFile)).get("headroom")!;
    assert.deepEqual({ insufficient: st.insufficient, extrapolated: st.extrapolated }, { insufficient: true, extrapolated: 0 });
    assert.match(st.reason!, /only the larger outputs/);
  } finally {
    t.done();
  }
});

test("an older saver earlier on PATH does not hide the current one in the tools folder", async () => {
  const t = tmp();
  try {
    const put = (dir: string, version: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "rtk"), `#!/usr/bin/env node\nif (process.argv[2] === "--version") console.log("rtk ${version}");\nelse process.exit(2);\n`, { mode: 0o755 });
      return join(dir, "rtk");
    };
    const old = put(join(t.dir, "old"), "0.1.4");
    const newer = put(join(t.dir, "newer"), "0.51.0");
    const ours = put(join(t.dir, "home", "tools", "bin"), "0.50.0");
    const rtk = SAVERS.filter((s) => s.id === "rtk");
    const env = { SAVER_AUDIT_HOME: join(t.dir, "home"), SAVER_AUDIT_RTK: undefined, SAVER_AUDIT_HEADROOM_PYTHON: "" };
    const detect = (first: string) => withEnv({ ...env, PATH: `${join(t.dir, first)}${delimiter}${process.env.PATH}` }, () => detectReplayTools(rtk).get("rtk"));
    assert.deepEqual(await detect("old"), { saver: "rtk", command: ours, version: "0.50.0" });
    assert.deepEqual(await detect("newer"), { saver: "rtk", command: newer, version: "0.51.0" }, "your own newer install comes first");
    rmSync(ours);
    assert.deepEqual(await detect("old"), { saver: "rtk", command: old, version: "0.1.4" }, "the only one is used (the report notes its version)");
    assert.deepEqual([isOutdated("0.1.4", "0.50.0"), isOutdated("0.50.0", "0.50.0"), isOutdated("v1.2", "0.50.0"), isOutdated("unknown", "0.50.0")], [true, false, false, false]);
  } finally {
    t.done();
  }
});

/** A Python 3 interpreter for the tests that run headroom's real sidecar code on a stub package (skipped without one). */
const PYTHON = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout?.trim() || undefined;
const PY_STUBS = fileURLToPath(new URL("./fixtures/python/", import.meta.url));
const REPLAY = new URL("../src/savers/replay.ts", import.meta.url).href;

/** Detects headroom (the stub) and replays `texts` through it, in a separate process started in `cwd`. */
function stubHeadroom(cwd: string, texts: string[], env: Record<string, string> = {}): { version?: string; stats?: Record<string, number>; d: number[] } {
  const script = `
    import { detectReplayTools, runReplays } from ${JSON.stringify(REPLAY)};
    import { countProxy } from ${JSON.stringify(new URL("../src/accounting/tokens.ts", import.meta.url).href)};
    const texts = ${JSON.stringify(texts)};
    const jobs = texts.map((input, i) => ({ saver: "headroom", key: "k" + i, tool: "Bash", cls: "Shell|tests", baseline: countProxy(input), headerTokens: 0, addTokens: 0, timeline: "main", block: i, input }));
    const f = { file: "f", source: "claude-code", records: [], skippedLines: 0, savers: { timelines: { main: { blocks: jobs.map(() => ({ d: [0], r: [0] })) } }, jobs, covered: [0], toolTokens: 0 } };
    const tools = detectReplayTools([]);
    const stats = tools.has("headroom") ? (await runReplays([f], ["headroom"], { tools, full: true, concurrency: 1 })).get("headroom") : undefined;
    console.log(JSON.stringify({ version: tools.get("headroom")?.version, stats, d: f.savers.timelines.main.blocks.map((b) => b.d[0]) }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd, env: { ...process.env, SAVER_AUDIT_HEADROOM_PYTHON: PYTHON!, PYTHONPATH: PY_STUBS, SAVER_AUDIT_HOME: join(cwd, "..", "home"), ...env }, encoding: "utf8" });
  return JSON.parse(out);
}

test("headroom's Python never imports code from the folder saver-audit runs in", async (c) => {
  if (!PYTHON) return c.skip("no python3");
  const t = tmp();
  try {
    const repo = join(t.dir, "repo");
    mkdirSync(join(repo, "headroom"), { recursive: true });
    const marker = join(t.dir, "imported");
    const plant = `open(${JSON.stringify(marker)}, "a").write(__name__ + "\\n")\n`;
    writeFileSync(join(repo, "headroom", "__init__.py"), `${plant}__version__ = "planted"\n`);
    writeFileSync(join(repo, "json.py"), plant);
    const r = stubHeadroom(repo, [text(0)]);
    assert.equal(existsSync(marker) ? readFileSync(marker, "utf8") : "", "", "nothing from the current folder was imported");
    assert.equal(r.version, "0.38.0");
    assert.deepEqual({ ran: r.stats?.ran, failed: r.stats?.failed, d: r.d }, { ran: 1, failed: 0, d: [0] }, "the stub compressor changes nothing");
  } finally {
    t.done();
  }
});

test("savers run in an empty folder, without the user's own saver settings or stores", async () => {
  const t = tmp();
  try {
    const temp = join(realpathSync(t.dir), "tmp");
    mkdirSync(temp);
    const log = join(t.dir, "runs.jsonl");
    const f = synth("caveman-engine", [{ key: "k0", input: text(0) }]);
    const user = { CAVEMAN_CCR_DB: join(t.dir, "user", "ccr.db"), CAVEMAN_HOME: join(t.dir, "user"), TOKEN_SAVER_MIN_INPUT_LENGTH: "99999999", TMPDIR: temp };
    await withEnv(user, () => runReplays([f], ["caveman-engine"], { tools: tool("caveman-engine", "fake-saver", { FAKE_ENV_LOG: log }), full: true, concurrency: 1 }));
    const run = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]!);
    const state = dirname(run.env.CAVEMAN_HOME);
    assert.equal(dirname(state), temp, "caveman's home is in this run's temporary folder");
    assert.equal(run.env.CAVEMAN_CCR_DB, join(state, "caveman", "ccr.db"), "so is its recovery store");
    assert.equal(run.env.TOKEN_SAVER_MIN_INPUT_LENGTH, undefined, "the user's token-saver settings are left out");
    assert.equal(run.cwd, join(state, "empty"), "not the folder saver-audit runs in (a .token-saver.json there)");
    assert.deepEqual(readdirSync(temp), [], "removed after the run");
  } finally {
    t.done();
  }
});

test("rtk runs with its telemetry and hook warning off, for the version probe too", async () => {
  const t = tmp();
  try {
    const log = join(t.dir, "runs.jsonl");
    const env = { SAVER_AUDIT_RTK: join(BIN, "fake-saver"), FAKE_ENV_LOG: log, SAVER_AUDIT_HOME: t.dir, SAVER_AUDIT_HEADROOM_PYTHON: "" };
    const tools = await withEnv(env, () => detectReplayTools(SAVERS.filter((s) => s.id === "rtk")));
    await withEnv(env, () => runReplays([synth("rtk", [{ key: "k0", input: text(0), args: ["pipe", "--filter", "pytest"] }])], ["rtk"], { tools, full: true, concurrency: 1 }));
    const runs = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(runs.map((r) => r.args[0]), ["--version", "pipe"]);
    for (const r of runs) assert.deepEqual([r.env.RTK_TELEMETRY_DISABLED, r.env.RTK_SUPPRESS_HOOK_WARNING], ["1", "1"], r.args[0]);
  } finally {
    t.done();
  }
});

test("token-saver and lean-ctx get a whole temporary home: HOME, the XDG folders and the Windows profile folders", async () => {
  const t = tmp();
  try {
    const log = join(t.dir, "runs.jsonl");
    const user = { XDG_CONFIG_HOME: join(t.dir, "config"), XDG_DATA_HOME: join(t.dir, "data"), USERPROFILE: t.dir, APPDATA: t.dir };
    for (const saver of ["token-saver", "lean-ctx"]) {
      const f = synth(saver, [{ key: `${saver}0`, input: text(0) }]);
      await withEnv(user, () => runReplays([f], [saver], { tools: tool(saver, "fake-saver", { FAKE_ENV_LOG: log }), full: true, concurrency: 1 }));
    }
    for (const r of readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))) {
      const home = r.env.HOME;
      assert.match(home, /saver-audit-[^/]+\/(token-saver|lean-ctx)-home$/);
      for (const k of ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) assert.ok(r.env[k].startsWith(home), `${k}: ${r.env[k]}`);
    }
  } finally {
    t.done();
  }
});

test("headroom gets non-ASCII text intact on any code page (Windows pipes are not UTF-8)", async (c) => {
  if (!PYTHON) return c.skip("no python3");
  const t = tmp();
  try {
    const repo = join(t.dir, "repo");
    mkdirSync(repo);
    // PYTHONIOENCODING=cp1252 decodes pipes the way Windows does; 0x9D (in ❌) is undefined there.
    const r = stubHeadroom(repo, [`→ résumé ✓ ${text(0, 500)}`, `Rīgā ❌ Á ${text(1, 500)}`], { PYTHONIOENCODING: "cp1252" });
    assert.deepEqual({ failed: r.stats?.failed, d: r.d }, { failed: 0, d: [0, 0] }, "the stub compressor changes nothing");
  } finally {
    t.done();
  }
});

test("headroom results cached on Windows before that fix are measured again", () => {
  const headroom = SAVERS.find((s) => s.id === "headroom")!;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const key = (os: string) => {
    Object.defineProperty(process, "platform", { ...platform, value: os });
    try {
      return replayKey(headroom, "Bash", undefined, "out");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  };
  assert.equal(key("darwin"), key("linux"));
  assert.notEqual(key("win32"), key("linux"));
});

test("the headroom sidecar has exited before its state folder is removed", async () => {
  const t = tmp();
  try {
    const temp = join(t.dir, "tmp");
    mkdirSync(temp);
    const f = synth("headroom", [0, 1].map((i) => ({ key: `h${i}`, input: text(i) })));
    const st = await withEnv({ TMPDIR: temp }, () => runReplays([f], ["headroom"], { tools: tool("headroom", "fake-headroom", { FAKE_EXIT_MS: "300" }), full: true, concurrency: 1 }));
    assert.equal(st.get("headroom")!.failed, 0);
    await new Promise((r) => setTimeout(r, 600));
    assert.deepEqual(readdirSync(temp), [], "no store written after the folder was removed (on Windows: EBUSY while it is open)");
  } finally {
    t.done();
  }
});
