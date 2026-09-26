import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFiles, saverBlockWeights, summarize, type FileResult } from "../src/audit.ts";
import type { CallRecord } from "../src/accounting/buckets.ts";
import { processAll, runAudit } from "../src/pool.ts";
import { runReplays } from "../src/savers/replay.ts";
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

test("rtk is credited only for commands its hook rewrites (`rtk rewrite`, rtk 0.50.0)", () => {
  const rewritten: Array<[string, string]> = [
    ["nice -n 10 pytest -q", "pytest"],
    ["timeout -s KILL 60 cargo test", "cargo-test"],
    ["nohup pytest -q", "pytest"],
    ["exec pytest -q", "pytest"],
    ["command rg foo", "grep"],
    ["(cd web && pytest -q)", "pytest"],
    ["grep '$(foo)' src", "grep"],
    ["grep \"<<\" src", "grep"],
    // routes follow the program names and forms rtk's hook rewrites
    ["./vendor/bin/phpunit", "phpunit"],
    ["./vendor/bin/pest", "pest"],
    ["./vendor/bin/paratest", "pest"],
    ["./vendor/bin/phpstan analyse", "phpstan"],
    ["phpstan analyze src", "phpstan"],
    ["./vendor/bin/pint", "pint"],
    ["./vendor/bin/ecs", "ecs"],
    ["pnpm prettier --check .", "prettier"],
    ["pnpm exec prettier --check .", "prettier"],
    ["bunx tsc --noEmit", "tsc"], // `rtk bunx tsc` runs rtk's tsc filter
    ["ruff check --fix .", "ruff-check"],
  ];
  for (const [cmd, f] of rewritten) assert.equal(rtkFilter(cmd), f, cmd);
  const leftAlone = ["sudo git diff", "sudo -u www git diff", "sudo -E pytest -q", "xargs -n 1 grep foo", "env -u HOME CI=1 npx vitest run", "(pytest -q)", "make && (pytest -q)", "cd web && (pytest -q)", "{ pytest -q; }", "command -v rg", "timeout --unknown 60 cargo test"];
  // A command substitution or a heredoc anywhere in the command.
  leftAlone.push("cargo nextest run", "cargo nextest run --workspace", "yarn tsc", "yarn tsc --noEmit", "yarn vitest", "yarn vitest run", "egrep -rn foo src", "fd x", "fd -e ts", "ruff .", "ruff src/", "ruff --fix .");
  leftAlone.push("phpstan", "vendor/bin/phpstan", "pytest-watch", "ecs-cli deploy", "tsc-alias", "phpunit-watcher");
  // Rewritten to `rtk bunx vitest run`, which passes the output through bunx's generic filter, not vitest's.
  leftAlone.push("bunx vitest run");
  leftAlone.push("git diff $(git merge-base HEAD main)", "pytest \"$(cat args)\"", "echo `date` && pytest -q", "cat > x.txt <<EOF\nhello\nEOF\npytest -q", "pytest -q <<< y");
  for (const cmd of leftAlone) assert.equal(rtkFilter(cmd), undefined, cmd);
});

test("in a pipeline rtk is credited for the stage its hook rewrites (`rtk rewrite`, rtk 0.50.0)", () => {
  const rewritten: Array<[string, string]> = [
    // a final grep or rg: `pytest -q 2>&1 | rtk grep FAILED`
    ["pytest -q 2>&1 | grep FAILED", "grep"],
    ["cargo test 2>&1 | grep -A5 panicked", "grep"],
    ["git diff | grep foo", "grep"],
    ["pytest -q | sort | grep FAIL", "grep"],
    // the first program, when the rest only passes its output through
    ["pytest -q | tail -5", "pytest"],
    ["cargo test 2>&1 | tail -30", "cargo-test"],
    ["git diff | cat", "git-diff"],
    ["pytest -q | head -5 | tail -2", "pytest"],
    ["rg -n \"foo|bar\" src | head -20", "grep"],
    ["grep -E \"a|b\" src", "grep"],
    // `||` is a list, not a pipe
    ["false || pytest", "pytest"],
    ["pytest -q || true", "pytest"],
    ["pytest -q || exit 1", "pytest"],
    ["pytest -q | tail -5 && echo done", "pytest"],
  ];
  for (const [cmd, f] of rewritten) assert.equal(rtkFilter(cmd), f, cmd);
  const leftAlone = [
    "cargo test 2>&1 | grep -E \"test result|FAILED\" | head -20",
    "pytest | grep -v PASS | tail",
    "go test ./... | sort",
    "rg foo | wc -l",
    "pytest -q | tee out.log",
    "find . -name x | xargs grep foo",
    "pytest -q | tail -f",
    "pytest -q |& grep FAIL",
    "make && pytest -q | sort",
    // programs rtk does not rewrite with their output piped on
    "npx tsc --noEmit 2>&1 | head -30",
    "vitest run | tail -5",
    "ctest | head",
    "sqlfluff lint x.sql | head",
    // a pipe and a subshell or `{ }` group in one command
    "(cd web && pytest -q) | tail -20",
    "(cd web && pytest -q | tail -5)",
    "(cd web && git diff) | head",
    "pytest -q ${ARGS} | tail",
  ];
  for (const cmd of leftAlone) assert.equal(rtkFilter(cmd), undefined, cmd);
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
  const text = `<persisted-output>\nOutput too large (40KB). Full output saved to: /x/y.txt\n\nPreview (first 2KB):\n${raw.slice(0, 1000)}\n</persisted-output>`;
  const o: OutputView = { source: "claude-code", tool: "Bash", category: "Shell", family: "tests", command: "pytest -q", text, raw, tokens: countProxy(text) };
  assert.ok(o.tokens < byId.get("token-saver")!.minTokens! && o.tokens < byId.get("lean-ctx")!.minTokens!, "the preview is under token-saver's and lean-ctx's floor");
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
  const rec1 = record("a", "2026-09-20T10:00:00Z", { cacheWrite: 10_000 }, { newRaw: { "tool:File reads|": 1000 }, range: { tl: "main", ctxStart: 0, newStart: 0, newEnd: 1, first: true } });
  const rec2 = record("b", "2026-09-20T10:01:00Z", { cacheRead: 20_000, cacheWrite: 100 }, { oldRaw: { "tool:File reads|": 1000 }, range: { tl: "main", ctxStart: 0, newStart: 1, newEnd: 1, first: false } });
  const savers = saverIndex(["codegraph"]);
  const file: FileResult = { file: "f", source: "claude-code", records: [rec1, rec2], skippedLines: 0, savers: { timelines: { main: { blocks: [{ d: [400] }] } }, jobs: [], covered: [1000], toolTokens: 2000 } };
  const r = summarize(fixtureOptions(), [file], { savers, tools: new Map(), stats: new Map() });
  const row = r.savers[0]!;
  assert.ok(Math.abs(row.cost - (400 * 5 + 400 * 0.2) / 1e6) < 1e-12, String(row.cost));
  assert.ok(Math.abs(row.tokens - 800) < 1e-9);
  assert.equal(row.coverage, 0.5);
});

test("caveman skill: output cut minus its SKILL.md in the prompt", () => {
  const rec = record("a", "2026-09-20T10:00:00Z", { cacheWrite: 10_000, output: 1000 }, { range: { tl: "main", ctxStart: 0, newStart: 0, newEnd: 0, first: true } });
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

test("quick mode: rtk exact; caveman replays its few new outputs; headroom waits for an exact run, which then carries over", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-quick-"));
  try {
    const cacheFile = join(dir, "replay.json");
    const ids = ["rtk", "caveman-engine", "headroom"];
    const quick = await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile });
    const q = new Map(quick.savers.map((s) => [s.id, s]));
    assert.equal(q.get("rtk")!.replay!.extrapolated, 0, "rtk always finishes");
    assert.deepEqual({ ran: q.get("caveman-engine")!.replay!.ran > 0, extrapolated: q.get("caveman-engine")!.replay!.extrapolated }, { ran: true, extrapolated: 0 }, "caveman replays its few new outputs");
    assert.equal(q.get("headroom")!.replay!.insufficient, true, "headroom is not sampled");
    await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile, full: ["headroom"] });
    const after = new Map((await runAudit(fixtureOptions(), undefined, 1, { ids, tools: FAKE_TOOLS, cacheFile })).savers.map((s) => [s.id, s]));
    assert.equal(after.get("headroom")!.replay!.extrapolated, 0, "exact results are reused by quick runs");
    assert.equal(after.get("headroom")!.replay!.insufficient, undefined);
    assert.equal(after.get("caveman-engine")!.replay!.ran, 0, "served from the cache");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("block weights price a saved token as the report does: Σ d × weight is each replayed saver's dollars", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-weights-"));
  try {
    const opts = fixtureOptions();
    const ids = ["rtk", "caveman-engine", "headroom"];
    const savers = saverIndex(ids);
    const config = { ids, replayable: ids, cacheFile: join(dir, "c.json"), until: new Date(opts.untilMs).toISOString(), versions: { rtk: "0.50.0", headroom: "0.38.0" } };
    const results = await processAll(findFiles(opts), undefined, 1, config);
    const w = saverBlockWeights(opts, results); // before replay: it needs no saving
    assert.ok(w.size > 0);
    const stats = await runReplays(results, ids, { tools: FAKE_TOOLS, cacheFile: config.cacheFile, full: true, concurrency: 1, blockWeights: w });
    const report = summarize(opts, results, { savers, tools: FAKE_TOOLS, stats });
    ids.forEach((id, i) => {
      let usd = 0;
      let tokens = 0;
      for (const [block, weight] of w) {
        usd += block.d[i]! * weight.usd;
        tokens += block.d[i]! * weight.tokens;
      }
      const row = report.savers.find((s) => s.id === id)!;
      assert.ok(Math.abs(usd - row.cost) <= 1e-9 * Math.max(1, Math.abs(row.cost)), `${id}: ${usd} vs ${row.cost}`);
      assert.ok(Math.abs(tokens - row.tokens) <= 1e-9 * Math.max(1, Math.abs(row.tokens)), `${id}: ${tokens} vs ${row.tokens} tokens`);
    });
    assert.ok(report.savers.some((s) => s.cost > 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
