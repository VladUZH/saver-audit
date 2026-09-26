// The short view names a key only when the menu after it offers that key.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditResult, SaverRow } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { exactPending, menuKeys, renderShort, renderTerminal } from "../src/report/terminal.ts";
import { exactSeconds } from "../src/savers/replay.ts";
import { installOffer, installPlan } from "../src/savers/toolsdir.ts";
import { CLAUDE_ROOT, CODEX_HOME, FAKE_TOOLS, FIXTURES, fixtureOptions } from "./helpers.ts";
import { inTerminalUntil, noTerminal } from "./pty.ts";

const OPTS = { showProjects: false, verbose: false, color: false };
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const temps: string[] = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));
const amt = (tokens: number, cost: number) => ({ tokens, cost });

function saver(id: string, name: string, cost: number, over: Partial<SaverRow> = {}): SaverRow {
  return { id, name, repo: "example/x", method: "replayed", version: "1.0.0", licence: "MIT", status: "ok", covers: "", coverage: 0.5, tokens: cost * 1e5, cost, codexCost: 0, codexHypothetical: false, ...over };
}

/** A synthetic result with a $100 total and these savers. */
function result(savers: SaverRow[]): AuditResult {
  return {
    period: { since: "2026-08-27T12:00:00.000Z", until: "2026-09-26T12:00:00.000Z" },
    looked: [],
    sources: ["claude-code"],
    files: 4,
    sessions: { main: 4, subagent: 0, bySource: { "claude-code": 4 }, sources: ["claude-code"] },
    calls: 400,
    models: [{ model: "claude-opus-5-5", pricedAs: "claude-opus-5-5", calls: 400, tokens: 1e7, cost: 100 }],
    billing: { input: amt(1e5, 10), cacheWrite: amt(1e5, 10), cacheRead: amt(9e6, 40), output: amt(8e5, 40), webSearch: { requests: 0, cost: 0, unpriced: 0 }, total: amt(1e7, 100) },
    buckets: [{ key: "tool:Shell", label: "Tool output: Shell", group: "context", tokens: 1e6, cost: 50 }],
    waste: [],
    projects: [],
    calibration: [],
    savers,
    prices: { date: "2026-09-25", sources: [] },
    skipped: { lines: 0, unreadableFiles: 0, duplicateCalls: 0, outsidePeriod: 0, notBillable: 0 },
  };
}

test("a cache-only saver with little left to replay: [e] is offered, as the view says", async () => {
  // caveman's engine is cache-only in quick mode; the fixtures leave it a second of work.
  const dir = mkdtempSync(join(tmpdir(), "sa-e2r-"));
  temps.push(dir);
  const tools = new Map([["caveman-engine", FAKE_TOOLS.get("caveman-engine")!]]);
  const r = await runAudit(fixtureOptions(), undefined, 1, { ids: ["caveman-engine"], tools, cacheFile: join(dir, "c.json"), full: false });
  const work = exactSeconds(new Map(r.savers.filter((s) => s.replay).map((s) => [s.id, s.replay!])));
  assert.ok(work.total <= 1, "under the second [e] used to need");
  assert.equal(exactPending(r), true);
  assert.equal(menuKeys(r, { menu: true }).exact, true, "the menu offers [e]");
  assert.match(renderShort(r, { ...OPTS, menu: true }), /caveman engine\s+—\s+exact run needed: press \[e\]/);
});

test("nothing left to replay: neither the menu nor the view offers [e]", () => {
  const exact = saver("rtk", "rtk", 5, { replay: { total: 50, pending: 0, ran: 50, extrapolated: 0, failed: 0 } });
  const r = result([exact]);
  assert.equal(menuKeys(r, { menu: true }).exact, false);
  assert.doesNotMatch(renderShort(r, { ...OPTS, menu: true }), /\[e\]/);
});

test("without a key menu, the short view gives the flags instead of keys", () => {
  const pending = saver("caveman-engine", "caveman (proxy engine)", 0, { replay: { total: 50, pending: 50, ran: 0, extrapolated: 0, failed: 0, insufficient: true } });
  const sampled = saver("rtk", "rtk", 5, { replay: { total: 500, pending: 200, ran: 300, extrapolated: 200, failed: 0 } });
  const missing = saver("lean-ctx", "lean-ctx", 0, { status: "not installed" });
  const r = result([sampled, pending, missing]);
  for (const o of [OPTS, { ...OPTS, menu: false, install: { ids: ["lean-ctx"], why: new Map() } }]) {
    const short = renderShort(r, o);
    assert.doesNotMatch(short, /\[e\]|\[i\]/);
    assert.match(short, /caveman engine\s+—\s+exact run needed: --exact/);
    assert.match(short, /For exact numbers \(once; cached\): npx saver-audit --exact/);
    assert.match(short, /Not installed: lean-ctx\. To install and measure it: npx saver-audit --install-savers/);
  }
  const menu = renderShort(r, { ...OPTS, menu: true, install: { ids: ["lean-ctx"], why: new Map() } });
  assert.match(menu, /exact run needed: press \[e\]/);
  assert.match(menu, /Press \[e\] for exact numbers/);
  assert.match(menu, /Not installed: lean-ctx\. Press \[i\] to install and measure it\.$/m, "no '(seconds)': these downloads take longer");
});

test("[i] is promised only for savers the installer can add here; the others say why not", () => {
  const ts = saver("token-saver", "token-saver", 0, { status: "not installed" });
  const community = saver("my-saver", "my-saver", 0, { status: "not installed", install: "pip install my-saver" });
  const rtk = saver("rtk", "rtk", 0, { status: "not installed" });
  const none = { ids: [], why: new Map([["token-saver", "needs Python 3.10+"]]) };
  const r = result([ts, community]);
  assert.equal(menuKeys(r, { menu: true, install: none }).install, false);
  const short = renderShort(r, { ...OPTS, menu: true, install: none });
  assert.match(short, /Not installed: token-saver \(needs Python 3\.10\+\), my-saver \(pip install my-saver\)\./);
  assert.doesNotMatch(short, /\[i\]|--install-savers/);
  const some = renderShort(result([rtk, community]), { ...OPTS, menu: true, install: { ids: ["rtk"], why: new Map() } });
  assert.match(some, /Not installed: rtk\. Press \[i\] to install and measure it\.\n\s+Also not installed: my-saver \(pip install my-saver\)\./);
});

test("the full report gives the installer's reason for a saver it cannot add here, as the short view does", () => {
  // On Windows the installer adds rtk but not lean-ctx; both manifests name --install-savers.
  const rtk = saver("rtk", "rtk", 0, { status: "not installed", install: "npx saver-audit --install-savers (or: brew install rtk)" });
  const lean = saver("lean-ctx", "lean-ctx", 0, { status: "not installed", install: "npx saver-audit --install-savers" });
  const r = result([rtk, lean]);
  const install = installOffer(r.savers, installPlan("win32", "x64", null));
  assert.deepEqual(install.ids, ["rtk"]);
  assert.match(renderShort(r, { ...OPTS, install }), /Also not installed: lean-ctx \(its settings cannot be kept apart from yours on Windows\)\./);
  const full = renderTerminal(r, { ...OPTS, install });
  assert.match(full, /Not installed, so not replayed: rtk \(npx saver-audit --install-savers \(or: brew install rtk\)\), lean-ctx \(its settings cannot be kept apart from yours on Windows\)\./);
  assert.doesNotMatch(full, /lean-ctx \(npx saver-audit --install-savers\)/);
  // Without an offer (nothing looked at), the manifests' commands.
  assert.match(renderTerminal(r, OPTS), /lean-ctx \(npx saver-audit --install-savers\)/);
});

test("the CLI's full report is given the install offer", { skip: process.platform === "win32" ? "the reason differs on Windows" : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-e2r-"));
  temps.push(dir);
  // No token-saver anywhere: its Python is not looked for, so the report says what decides.
  const env = { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: dir, XDG_CACHE_HOME: join(dir, "cache"), SAVER_AUDIT_HOME: join(dir, "home"), CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME, NO_COLOR: "1" };
  const r = spawnSync(process.execPath, [CLI, "--full", "--no-card", "--since", "2026-09-01", "--until", "2026-09-30", "--savers", "token-saver"], { env, cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Not installed, so not replayed: token-saver \(needs Python 3\.10\+; to install: npx saver-audit --install-savers\)\./);
});

test("in a terminal, the menu offers the keys the short view names, and only those", { skip: noTerminal }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-e2r-"));
  temps.push(dir);
  const bin = join(FIXTURES, "bin");
  // lean-ctx and token-saver are nowhere; node is on PATH for the fake savers.
  const env = { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: dir, XDG_CACHE_HOME: join(dir, "cache"), SAVER_AUDIT_HOME: join(dir, "home"), CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME, NO_COLOR: "1", SAVER_AUDIT_RTK: join(bin, "rtk"), CAVEMAN_ENGINE_BIN: join(bin, "caveman-engine") };
  // The CLI up to its menu, which waits for keys.
  const run = async (savers: string) => (await inTerminalUntil([CLI, "--since", "2026-09-01", "--until", "2026-09-30", "--savers", savers, "--no-card", "--no-animation"], { env, cwd: dir }, /\[q\] quit/)) ?? "";
  const menu = (out: string) => out.split(/\r?\n/).find((l) => l.includes("[q] quit")) ?? "";
  // caveman's engine needs an exact run; the installer can add lean-ctx here.
  const both = await run("rtk,caveman-engine,lean-ctx");
  assert.match(both, /caveman engine\s+—\s+exact run needed: press \[e\]/);
  assert.match(both, /Not installed: lean-ctx\. Press \[i\] to install and measure it\./);
  assert.match(menu(both), /\[e\] exact numbers/);
  assert.match(menu(both), /\[i\] install savers/);
  // token-saver needs Python, which only the installer looks for: [i] in neither.
  const none = await run("rtk,token-saver");
  assert.match(none, /Not installed: token-saver \(needs Python 3\.10\+/);
  assert.match(menu(none), /\[f\] full report/);
  assert.doesNotMatch(none, /\[i\]/);
});

test("--short and a run without a terminal on input name no keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-e2r-"));
  temps.push(dir);
  const bin = join(FIXTURES, "bin");
  const env = { PATH: process.env.PATH, HOME: dir, XDG_CACHE_HOME: join(dir, "cache"), SAVER_AUDIT_HOME: join(dir, "home"), CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME, NO_COLOR: "1", SAVER_AUDIT_RTK: join(bin, "rtk"), CAVEMAN_ENGINE_BIN: join(bin, "caveman-engine") };
  const r = spawnSync(process.execPath, [CLI, "--short", "--since", "2026-09-01", "--until", "2026-09-30", "--savers", "rtk,caveman-engine,lean-ctx"], { env, cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /caveman engine\s+—\s+exact run needed: --exact/);
  assert.doesNotMatch(r.stdout, /\[e\]|\[i\]/);
});

test("install hints give the command that works under npx", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-e2r-"));
  temps.push(dir);
  // No tools: every replayed saver is missing, so its install note is shown.
  const r = await runAudit(fixtureOptions(), undefined, 1, { ids: ["rtk", "caveman-engine", "token-saver", "lean-ctx", "headroom"], tools: new Map(), cacheFile: join(dir, "c.json"), full: false });
  const full = renderTerminal(r, OPTS);
  assert.match(full, /rtk \(npx saver-audit --install-savers \(or: brew install rtk\)\)/);
  for (const name of ["caveman \\(proxy engine\\)", "token-saver", "lean-ctx"]) assert.match(full, new RegExp(`${name} \\(npx saver-audit --install-savers\\)`), name);
  assert.match(renderShort(r, OPTS), /headroom is a 1\.6 GB install; add it with: npx saver-audit --install-savers --with-headroom/);
  assert.doesNotMatch(full + renderShort(r, OPTS), /(^|[^x] )saver-audit --/m);
});
