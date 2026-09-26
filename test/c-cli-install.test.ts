// --install-savers from the command line: output streams, exit codes, no terminal.
// The quick savers are the fake binaries (so nothing is downloaded) and headroom
// installs with the fake Python (no pip, no model).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_ROOT, CODEX_HOME, FIXTURES } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const BIN = join(FIXTURES, "bin");
const unix = process.platform === "win32" ? "needs sh" : false;
const temps: string[] = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * Runs the CLI with its own tools folder; stdin is not a terminal. `only`: PATH holds
 * just the fake python3 and node, so no real Python can be found.
 */
function cli(args: string[], extra: Record<string, string> = {}, only = false) {
  const root = mkdtempSync(join(tmpdir(), "sa-cli-"));
  temps.push(root);
  mkdirSync(join(root, "pybin"));
  copyFileSync(join(FIXTURES, "installer", "fake-python"), join(root, "pybin", "python3"));
  chmodSync(join(root, "pybin", "python3"), 0o755);
  if (only) symlinkSync(process.execPath, join(root, "pybin", "node"));
  const env = {
    PATH: only ? join(root, "pybin") : [join(root, "pybin"), dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
    HOME: root,
    SAVER_AUDIT_HOME: join(root, "home"),
    FAKE_PY_LOG: join(root, "calls.log"),
    XDG_CACHE_HOME: join(root, "cache"),
    CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT),
    CODEX_HOME,
    NO_COLOR: "1",
    SAVER_AUDIT_RTK: join(BIN, "rtk"),
    CAVEMAN_ENGINE_BIN: join(BIN, "caveman-engine"),
    SAVER_AUDIT_TOKEN_SAVER: join(BIN, "fake-trim"),
    SAVER_AUDIT_LEAN_CTX: join(BIN, "fake-trim"),
    ...extra,
  };
  // An empty value removes the variable (that saver then counts as not installed).
  for (const [k, v] of Object.entries(env)) if (v === "") delete env[k as keyof typeof env];
  const r = spawnSync(process.execPath, [CLI, "--no-savers", "--since", "2026-09-01", "--until", "2026-09-30", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { ...r, venv: join(env.SAVER_AUDIT_HOME, "tools", "headroom-venv") };
}

test("--install-savers with everything installed still runs the report, exit 0", { skip: unix }, () => {
  const r = cli(["--install-savers", "--yes"], { SAVER_AUDIT_HEADROOM_PYTHON: join(BIN, "headroom-python") });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already installed/);
  assert.match(r.stdout, /API-equivalent/);
});

test("--install-savers --json keeps stdout valid JSON: installer text goes to stderr", { skip: unix }, () => {
  const done = cli(["--install-savers", "--yes", "--json"], { SAVER_AUDIT_HEADROOM_PYTHON: join(BIN, "headroom-python") });
  assert.equal(done.status, 0, done.stderr);
  assert.doesNotThrow(() => JSON.parse(done.stdout), "nothing to install");
  assert.match(done.stderr, /already installed/);
  const fresh = cli(["--install-savers", "--with-headroom", "--yes", "--json"]);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.doesNotThrow(() => JSON.parse(fresh.stdout), "after an install");
  assert.match(fresh.stderr, /headroom 0\.38\.0 \+ its model: installed/);
});

test("without a terminal and without --yes, nothing is installed and it says how", { skip: unix }, () => {
  const r = cli(["--install-savers", "--with-headroom"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /input is not a terminal[^\n]*headroom 0\.38\.0 \+ its model\. Run again with --yes/);
  assert.match(r.stdout, /API-equivalent/, "the report still follows");
  assert.equal(existsSync(r.venv), false);
});

test("when nothing missing can be installed here, only the reasons are shown, no download banner", { skip: unix }, () => {
  // token-saver is missing, and the only Python is 3.9.
  const r = cli(["--install-savers", "--yes"], { SAVER_AUDIT_TOKEN_SAVER: "", FAKE_PY_VERSION: "3.9" }, true);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /token-saver v3\.0\.0: skipped \(needs Python 3\.10\+\)/);
  assert.doesNotMatch(r.stdout, /Downloads from/);
});

test("a failed install still prints the report, then exits 1", { skip: unix }, () => {
  const r = cli(["--install-savers", "--with-headroom", "--yes"], { FAKE_PY_NO_MODEL: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /headroom 0\.38\.0 \+ its model: not installed/);
  assert.match(r.stdout, /API-equivalent/);
});
