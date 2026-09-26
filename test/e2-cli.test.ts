// The CLI in a terminal: spinner, warnings and errors (run in a pseudo-terminal).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_ROOT, CODEX_HOME, FIXTURES } from "./helpers.ts";
import { inTerminal, noTerminal } from "./pty.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const BIN = join(FIXTURES, "bin");
const temps: string[] = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** The CLI in a terminal, on the fixtures, in an empty folder with its own home. */
function term(args: string[], extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "sa-term-"));
  temps.push(root);
  const env = { PATH: process.env.PATH, HOME: root, SAVER_AUDIT_HOME: join(root, "home"), XDG_CACHE_HOME: join(root, "cache"), CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME, ...extra };
  return inTerminal([CLI, ...args], { env, cwd: root })!;
}

test("a bad --last or --until is reported before the spinner starts, not on its line", { skip: noTerminal }, () => {
  for (const [args, error] of [
    [["--last", "30x"], /saver-audit: --last: expected e\.g\. 30d/],
    [["--until", "soon"], /saver-audit: --until: not a date: soon/],
  ] as const) {
    const out = term([...args, "--no-savers"]);
    assert.match(out, error);
    assert.doesNotMatch(out, /Reading your agent logs/, "no spinner for a run that cannot start");
  }
});

test("a bad --last stops --install-savers before it installs anything", () => {
  const root = mkdtempSync(join(tmpdir(), "sa-cli-"));
  temps.push(root);
  // Every saver counts as installed (the fakes), so even a regression downloads nothing.
  const env = { PATH: "/nonexistent", HOME: root, SAVER_AUDIT_HOME: join(root, "home"), SAVER_AUDIT_RTK: join(BIN, "rtk"), CAVEMAN_ENGINE_BIN: join(BIN, "caveman-engine"), SAVER_AUDIT_TOKEN_SAVER: join(BIN, "fake-trim"), SAVER_AUDIT_LEAN_CTX: join(BIN, "fake-trim"), SAVER_AUDIT_HEADROOM_PYTHON: join(BIN, "headroom-python") };
  const r = spawnSync(process.execPath, [CLI, "--install-savers", "--last", "30x"], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--last: expected/);
  assert.equal(r.stdout, "", "the installer never started");
});

test("a bad --savers stops --install-savers, and a bad argument stops --update-prices, before they start", () => {
  const root = mkdtempSync(join(tmpdir(), "sa-cli-"));
  temps.push(root);
  // Every saver counts as installed (the fakes) and fetch fails, so even a regression downloads nothing.
  const env = { PATH: "/nonexistent", HOME: root, SAVER_AUDIT_HOME: join(root, "home"), XDG_CACHE_HOME: join(root, "cache"), SAVER_AUDIT_RTK: join(BIN, "rtk"), CAVEMAN_ENGINE_BIN: join(BIN, "caveman-engine"), SAVER_AUDIT_TOKEN_SAVER: join(BIN, "fake-trim"), SAVER_AUDIT_LEAN_CTX: join(BIN, "fake-trim"), SAVER_AUDIT_HEADROOM_PYTHON: join(BIN, "headroom-python") };
  const offline = "data:text/javascript,globalThis.fetch = () => Promise.reject(new Error('fetch called'));";
  for (const [args, error] of [
    [["--install-savers", "--savers", "rkt"], /--savers: unknown saver "rkt"/],
    [["--update-prices", "--savers", "rkt"], /--savers: unknown saver "rkt"/],
    [["--update-prices", "--source", "codx"], /--source: expected/],
    [["--update-prices", "--last", "30x"], /--last: expected/],
    [["--update-prices", "--jobs", "0"], /--jobs: expected/],
  ] as const) {
    const r = spawnSync(process.execPath, ["--import", offline, CLI, ...args], { env, encoding: "utf8" });
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, error);
    assert.doesNotMatch(r.stderr, /--update-prices: fetching/, "the price list was not fetched");
    assert.equal(r.stdout, "", "the installer never started");
  }
});

test("a replay warning is shown in a terminal too, after the spinner, not dropped", { skip: noTerminal }, () => {
  const out = term(["--since", "2026-09-01", "--until", "2026-09-30", "--exact", "--savers", "headroom", "--full", "--no-animation"], { SAVER_AUDIT_HEADROOM_PYTHON: join(BIN, "fake-headroom"), FAKE_READY: "0" });
  assert.match(out, /headroom[^\n]*not measured: compression model not cached/);
  // On a line of its own, once the spinner line is cleared.
  assert.match(out, /\r\x1b\[Kheadroom: its compression model is not cached; skipped \(run headroom once online to download it\)\.\r?\n/);
});

test("NO_COLOR: the spinner draws no colour either", { skip: noTerminal }, () => {
  const out = term(["--since", "2026-09-01", "--until", "2026-09-30", "--no-savers", "--no-card", "--full", "--no-animation"], { NO_COLOR: "1" });
  assert.match(out, /Reading your agent logs/, "the spinner ran");
  assert.doesNotMatch(out, /\x1b\[3\dm/);
});

test("--install-savers offers a saver whose copy on PATH is older than its adapter", { skip: process.platform === "win32" ? "needs sh" : false }, () => {
  const root = mkdtempSync(join(tmpdir(), "sa-old-"));
  temps.push(root);
  mkdirSync(join(root, "old"));
  writeFileSync(join(root, "old", "rtk"), "#!/bin/sh\necho 'rtk 0.1.4'\n");
  chmodSync(join(root, "old", "rtk"), 0o755);
  // The other savers count as installed; input is not a terminal, so nothing is downloaded.
  const env = { PATH: [join(root, "old"), dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: root, SAVER_AUDIT_HOME: join(root, "home"), XDG_CACHE_HOME: join(root, "cache"), CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME, CAVEMAN_ENGINE_BIN: join(BIN, "caveman-engine"), SAVER_AUDIT_TOKEN_SAVER: join(BIN, "fake-trim"), SAVER_AUDIT_LEAN_CTX: join(BIN, "fake-trim") };
  const r = spawnSync(process.execPath, [CLI, "--install-savers", "--no-savers", "--since", "2026-09-01", "--until", "2026-09-30"], { env, cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /already installed/);
  assert.match(r.stdout, /rtk v0\.50\.0: the 0\.1\.4 found is older than the version saver-audit was written for\./);
  assert.match(r.stdout, /nobody could be asked: rtk v0\.50\.0\./);
});

test("--install-savers --with-headroom finishes an install whose tokenizer is missing, and says so", { skip: process.platform === "win32" ? "needs sh" : false }, () => {
  const root = mkdtempSync(join(tmpdir(), "sa-tt-"));
  temps.push(root);
  mkdirSync(join(root, "pybin"));
  copyFileSync(join(FIXTURES, "installer", "fake-python"), join(root, "pybin", "python3"));
  chmodSync(join(root, "pybin", "python3"), 0o755);
  const env = { PATH: [join(root, "pybin"), dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: root, SAVER_AUDIT_HOME: join(root, "home"), FAKE_PY_LOG: join(root, "calls.log"), XDG_CACHE_HOME: join(root, "cache"), CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME, SAVER_AUDIT_RTK: join(BIN, "rtk"), CAVEMAN_ENGINE_BIN: join(BIN, "caveman-engine"), SAVER_AUDIT_TOKEN_SAVER: join(BIN, "fake-trim"), SAVER_AUDIT_LEAN_CTX: join(BIN, "fake-trim") };
  const run = () => spawnSync(process.execPath, [CLI, "--install-savers", "--with-headroom", "--yes", "--no-savers", "--since", "2026-09-01", "--until", "2026-09-30"], { env, cwd: root, encoding: "utf8" });
  assert.equal(run().status, 0);
  rmSync(join(root, "home", "tools", "tiktoken", "o200k_base"));
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /headroom is installed but its model or tokenizer is missing; finishing the install\./);
  assert.match(r.stdout, /headroom 0\.38\.0 \+ its model: installed/);
});
