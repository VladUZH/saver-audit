import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarize, type FileResult } from "../src/audit.ts";
import type { CallRecord } from "../src/accounting/buckets.ts";
import { runAudit } from "../src/pool.ts";
import { rtkFilter, SAVERS, saverIndex, splitCodexHeader } from "../src/savers/registry.ts";
import { persistedHeader, presentedTokens, SaverTracker } from "../src/savers/tracker.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { routeMatches } from "../src/savers/manifest.ts";
import { emptyUsage } from "../src/sources/types.ts";
import type { OutputView } from "../src/savers/types.ts";
import { FAKE_TOOLS, fixtureOptions } from "./helpers.ts";


test("rtk filter chosen from the command; git status/log excluded", () => {
  const cases: Array<[string, string | undefined]> = [
    ["cd /x && pytest -q", "pytest"],
    ["python -m pytest tests/", "pytest"],
    ["cargo test --all", "cargo-test"],
    ["npx tsc --noEmit", "tsc"],
    ["rg -n foo src | head", "grep"],
    ["git diff HEAD~1", "git-diff"],
    ["git status", undefined],
    ["git log --oneline", undefined],
    ["npm test", undefined],
    ["FOO=1 go test ./...", "go-test"],
    // continued lines, and env assignments after a wrapper
    ["python -m pytest tests/ \\\n  -q --tb=short", "pytest"],
    ["python \\\n  -m pytest", "pytest"],
    ["grep -rn TODO src \\\n  | head -50", "grep"],
    ["rg -n foo src |\n  head -5", "grep"],
    ["git diff HEAD~3 \\\n  -- src/", "git-diff"],
    ["cargo test --workspace \\\r\n  -- --nocapture", "cargo-test"],
    ["env CI=1 npx vitest run", "vitest"],
    ["time CI=1 pytest -q", "pytest"],
  ];
  for (const [cmd, f] of cases) assert.equal(rtkFilter(cmd), f, cmd);
});

test("Codex header and Claude persisted-output header are split off", () => {
  assert.deepEqual(splitCodexHeader("Exit code: 0\nWall time: 1s\nOutput:\nhello"), { header: "Exit code: 0\nWall time: 1s\nOutput:\n", body: "hello" });
  assert.deepEqual(splitCodexHeader("no header"), { header: "", body: "no header" });
  const text = "<persisted-output>\nOutput too large (49KB). Full output saved to: /x/y.txt\n\nPreview (first 2KB):\nline1\nline2";
  assert.equal(persistedHeader(text), "<persisted-output>\nOutput too large (49KB). Full output saved to: /x/y.txt\n\nPreview (first 2KB):\n");
});

test("a saver's output still over the inline limit is shown as a preview again", () => {
  const job = { persistedHeader: "h", headerTokens: 20, addTokens: 0 };
  assert.equal(presentedTokens({ t: 9000, c: 40_000, p: 500 }, job), 520, "over 30k chars: header + first 2k chars");
  assert.equal(presentedTokens({ t: 7000, c: 25_000, p: 500 }, job), 7000, "under the limit: all of it inline (can exceed the preview)");
  assert.equal(presentedTokens({ t: 9000, c: 40_000, p: 500 }, { headerTokens: 0, addTokens: 5 }), 9005, "not a preview: whole output plus kept header");
});

test("coverage rules", () => {
  const view = (over: Partial<OutputView>): OutputView => ({ source: "claude-code", tool: "Bash", category: "Shell", family: "other", text: "x", tokens: 1, ...over });
  const byId = new Map(SAVERS.map((s) => [s.id, s]));
  assert.equal(byId.get("headroom")!.appliesTo(view({ tool: "Read", category: "File reads" })), false);
  assert.equal(byId.get("headroom")!.appliesTo(view({ tool: "Bash" })), true);
  assert.equal(byId.get("codegraph")!.appliesTo(view({ tool: "Read", category: "File reads" })), true);
  assert.equal(byId.get("codegraph")!.appliesTo(view({ family: "search" })), true);
  assert.equal(byId.get("codegraph")!.appliesTo(view({ family: "tests" })), false);
  assert.equal(byId.get("context-mode")!.appliesTo(view({ text: "a".repeat(5001) })), true);
  assert.equal(byId.get("context-mode")!.appliesTo(view({ text: "a".repeat(5000) })), false);
  assert.equal(byId.get("rtk")!.appliesTo(view({ command: "pytest" })), true);
  assert.equal(byId.get("rtk")!.appliesTo(view({ command: "ls -la" })), false);
  assert.throws(() => saverIndex(["nope"]));
});

test("a Claude preview does not hide the full output from tool-stage size rules", () => {
  const byId = new Map(SAVERS.map((s) => [s.id, s]));
  const raw = `collected 1200 items\n${"tests/test_x.py::test_case PASSED\n".repeat(1200)}`;
  const text = `<persisted-output>\nOutput too large (40KB). Full output saved to: /x/y.txt\n\nPreview (first 2KB):\n${raw.slice(0, 2000)}\n</persisted-output>`;
  const o: OutputView = { source: "claude-code", tool: "Bash", category: "Shell", family: "tests", command: "pytest -q", text, raw, tokens: countProxy(text) };
  assert.ok(o.tokens < 1000, "the preview is under token-saver's and lean-ctx's floor");
  const t = new SaverTracker(["token-saver", "lean-ctx", "context-mode"].map((id) => byId.get(id)!), new Set(["token-saver", "lean-ctx"]), () => undefined);
  t.output("main", undefined, o);
  assert.deepEqual(t.jobs.map((j) => [j.saver, j.persistedHeader !== undefined]), [["token-saver", true], ["lean-ctx", true]], "the full output is replayed");
  assert.equal(t.timelines.main!.blocks[0]!.d[2], o.tokens, "context-mode's ceiling: the preview tokens the model saw");
  // A proxy (request stage) sees the preview, so its size rules apply to that.
  assert.equal(routeMatches({ minBytes: 5000 }, o), false);
  assert.equal(routeMatches({ minBytes: 5000 }, o, "tool"), true);
});

test("an output without a recorded command is not covered by a saver route that passes one", () => {
  const byId = new Map(SAVERS.map((s) => [s.id, s]));
  const ids = ["token-saver", "lean-ctx"];
  const log = "server listening on :3000\n".repeat(400);
  const views: OutputView[] = [
    { source: "claude-code", tool: "BashOutput", category: "Shell", family: "", text: log, tokens: countProxy(log) },
    { source: "codex", tool: "write_stdin", category: "Shell", family: "", text: log, tokens: countProxy(log) },
  ];
  const t = new SaverTracker(ids.map((id) => byId.get(id)!), new Set(ids), () => undefined);
  for (const v of views) {
    for (const id of ids) assert.equal(byId.get(id)!.appliesTo(v), false, `${id} on ${v.tool}`);
    t.output("main", undefined, v);
  }
  assert.deepEqual(t.covered, [0, 0], "never replayed, so not in coverage");
  t.output("main", undefined, { ...views[0]!, tool: "Bash", command: "npm run dev" });
  assert.deepEqual(t.jobs.map((j) => j.saver), ids);
});

test("saver notes state method caveats only: no sampling claim, no retired flag", () => {
  // Quick mode never samples headroom (cache only) and --exact replays every output.
  const headroom = SAVERS.find((s) => s.id === "headroom")!;
  assert.doesNotMatch(headroom.assumption!, /sample/);
  assert.match(headroom.assumption!, /replayed as the newest message/);
  for (const s of SAVERS) assert.doesNotMatch(s.assumption ?? "", /--full-replay/, s.id);
});

function record(key: string, ts: string, usage: Partial<ReturnType<typeof emptyUsage>>, over: Partial<CallRecord>): CallRecord {
  const u = { ...emptyUsage(), ...usage };
  return { key, model: "claude-opus-5-5", timestamp: ts, call: { key, model: "claude-opus-5-5", usage: u, multiplier: 1, billable: true }, file: 0, oldRaw: {}, newRaw: {}, oldReal: 0, newReal: 0, proxyAppended: 0, ...over };
}

test("compounding: a removed token is a cache write once, then a cache read on every later call", () => {
  // Opus 5.5: 5m cache write $5/M, cache read $0.2/M. 1,000 tokens of file output,
  // of which the saver removes 400; it is new at call 1 and old at call 2.
  const rec1 = record("a", "2026-09-20T10:00:00Z", { cacheWrite: 10_000 }, { newRaw: { "tool:File reads|": 1000 }, range: { tl: "main", ctxStart: 0, newStart: 0, newEnd: 1, end: 1, first: true } });
  const rec2 = record("b", "2026-09-20T10:01:00Z", { cacheRead: 20_000, cacheWrite: 100 }, { oldRaw: { "tool:File reads|": 1000 }, range: { tl: "main", ctxStart: 0, newStart: 1, newEnd: 1, end: 1, first: false } });
  const savers = saverIndex(["codegraph"]);
  const file: FileResult = { file: "f", source: "claude-code", records: [rec1, rec2], skippedLines: 0, savers: { timelines: { main: { blocks: [{ d: [400], r: [0] }] } }, jobs: [], covered: [1000], toolTokens: 2000 } };
  const r = summarize(fixtureOptions(), [file], { savers, tools: new Map(), stats: new Map() });
  const row = r.savers[0]!;
  assert.ok(Math.abs(row.cost - (400 * 5 + 400 * 0.2) / 1e6) < 1e-12, String(row.cost));
  assert.ok(Math.abs(row.tokens - 800) < 1e-9);
  assert.equal(row.coverage, 0.5);
});

test("caveman skill: output cut minus its SKILL.md in the prompt", () => {
  const rec = record("a", "2026-09-20T10:00:00Z", { cacheWrite: 10_000, output: 1000 }, { range: { tl: "main", ctxStart: 0, newStart: 0, newEnd: 0, end: 0, first: true } });
  const file: FileResult = { file: "f", source: "claude-code", records: [rec], skippedLines: 0, savers: { timelines: { main: { blocks: [] } }, jobs: [], covered: [0], toolTokens: 0 } };
  const r = summarize(fixtureOptions(), [file], { savers: saverIndex(["caveman-skill"]), tools: new Map(), stats: new Map() });
  // 8.5% of 1,000 output tokens at $20/M, minus 1,650 skill tokens as a cache write at $5/M.
  assert.ok(Math.abs(r.savers[0]!.cost - (85 * 20 - 1650 * 5) / 1e6) < 1e-12, String(r.savers[0]!.cost));
});

test("replay through (fake) saver binaries: labelled, cached and reproducible", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-test-"));
  try {
    const cacheFile = join(dir, "replay.json");
    const ids = SAVERS.map((s) => s.id);
    const a = await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile, full: true });
    const b = await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile, full: true });
    const byId = new Map(a.savers.map((s) => [s.id, s]));
    for (const s of a.savers) assert.ok(["replayed", "modeled", "upper-bound"].includes(s.method), s.id);
    assert.ok(byId.get("rtk")!.cost > 0, "pytest output filtered by the fake rtk");
    assert.ok(byId.get("caveman-engine")!.cost > 0);
    assert.ok(byId.get("headroom")!.cost > 0);
    assert.ok(byId.get("rtk")!.replay!.ran >= 1);
    assert.equal(b.savers.find((s) => s.id === "rtk")!.replay!.ran, 0, "second run served from the cache");
    assert.deepEqual(b.savers.map(({ replay, ...s }) => s), a.savers.map(({ replay, ...s }) => s));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("savers not installed are reported, not guessed", async () => {
  const r = await runAudit(fixtureOptions(), undefined, 1, { ids: ["rtk", "codegraph"], tools: new Map() });
  const rtk = r.savers.find((s) => s.id === "rtk")!;
  assert.equal(rtk.status, "not installed");
  assert.equal(rtk.cost, 0);
  assert.equal(r.savers.find((s) => s.id === "codegraph")!.status, "ok");
});

test("outputs after the period end are not replayed or counted", async () => {
  const early = await runAudit(fixtureOptions({ untilMs: Date.parse("2026-09-20T10:00:05Z") }), undefined, 1, { ids: ["rtk"], tools: FAKE_TOOLS });
  const rtk = early.savers.find((s) => s.id === "rtk")!;
  assert.equal(rtk.replay?.total ?? 0, 0, "the pytest output at 10:00:10 is after the period end");
  assert.equal(rtk.coverage, 0);
});

test("quick mode: rtk exact; cache-only savers wait for an exact run, which then carries over", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-quick-"));
  try {
    const cacheFile = join(dir, "replay.json");
    const ids = ["rtk", "caveman-engine", "headroom"];
    const quick = await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile });
    const q = new Map(quick.savers.map((s) => [s.id, s]));
    assert.equal(q.get("rtk")!.replay!.extrapolated, 0, "rtk always finishes");
    assert.equal(q.get("caveman-engine")!.replay!.insufficient, true, "caveman is not estimated from a quick sample");
    assert.equal(q.get("headroom")!.replay!.insufficient, true);
    await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile, full: ["caveman-engine"] });
    const after = new Map((await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile })).savers.map((s) => [s.id, s]));
    assert.equal(after.get("caveman-engine")!.replay!.extrapolated, 0, "exact results are reused by quick runs");
    assert.ok(after.get("caveman-engine")!.cost > 0);
    assert.equal(after.get("headroom")!.replay!.insufficient, true, "only the savers asked for were made exact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
