// headroom's install with a fake Python (test/fixtures/installer/fake-python): no
// network, no real pip, no model.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { headroomIncomplete, installHeadroom, installPlan } from "../src/savers/install.ts";
import { toolPaths, toolsDir } from "../src/savers/toolsdir.ts";
import { CLAUDE_ROOT, CODEX_HOME, FIXTURES } from "./helpers.ts";

const FAKE = join(FIXTURES, "installer", "fake-python");
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const unix = process.platform === "win32" ? "needs sh" : false;
const quiet = () => {};
const temps: string[] = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

let root = "";
/** A fresh tools folder, with the fake python3 first on PATH. */
function setup(): void {
  root = mkdtempSync(join(tmpdir(), "sa-hr-"));
  temps.push(root);
  mkdirSync(join(root, "pybin"));
  copyFileSync(FAKE, join(root, "pybin", "python3"));
  chmodSync(join(root, "pybin", "python3"), 0o755);
  process.env.PATH = [join(root, "pybin"), "/usr/bin", "/bin"].join(delimiter);
  process.env.SAVER_AUDIT_HOME = join(root, "home");
  process.env.FAKE_PY_LOG = join(root, "calls.log");
  delete process.env.FAKE_PY_NO_VENV;
  delete process.env.FAKE_PY_NO_MODEL;
}
/** The fake Python's calls, first word only: venv, pip, prefetch. */
const calls = () => (existsSync(join(root, "calls.log")) ? readFileSync(join(root, "calls.log"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]) : []);

test("a venv whose base Python was removed is rebuilt, not reused", { skip: unix }, async () => {
  setup();
  mkdirSync(join(toolsDir(), "headroom-venv", "bin"), { recursive: true });
  symlinkSync("/nonexistent/python3.12", toolPaths.headroomPython());
  assert.equal(await installHeadroom(quiet), toolPaths.headroomPython());
  assert.deepEqual(calls(), ["venv", "pip", "prefetch"]);
  assert.equal(headroomIncomplete(), false);
});

test("pip keeps no download cache outside the tools folder", { skip: unix }, async () => {
  setup();
  await installHeadroom(quiet);
  const pip = readFileSync(join(root, "calls.log"), "utf8").split("\n").find((l) => l.startsWith("pip "));
  assert.match(pip ?? "", /--no-cache-dir/);
});

test("an install whose model download failed is finished by running it again", { skip: unix }, async () => {
  setup();
  process.env.FAKE_PY_NO_MODEL = "1";
  await assert.rejects(installHeadroom(quiet), /503 Server Error/);
  assert.equal(headroomIncomplete(), true, "headroom imports, but its model is missing");
  delete process.env.FAKE_PY_NO_MODEL;
  await installHeadroom(quiet);
  assert.deepEqual(calls(), ["venv", "pip", "prefetch", "pip", "prefetch"], "the venv is kept");
  assert.equal(headroomIncomplete(), false);
});

test("a Python without its venv module: headroom is skipped up front, and the error says what to install", { skip: unix }, async () => {
  setup();
  process.env.FAKE_PY_NO_VENV = "1";
  const hr = installPlan().find((c) => c.id === "headroom")!;
  assert.equal(hr.available, false);
  assert.match(hr.why ?? "", /python3-venv/);
  await assert.rejects(installHeadroom(quiet), /venv module is missing; install it \(for example: sudo apt install python3\.12-venv\)/);
  assert.equal(existsSync(join(toolsDir(), "headroom-venv")), false, "no half-made venv left behind");
});

test("--install-savers --with-headroom finishes a headroom whose model is missing", { skip: unix }, async () => {
  setup();
  process.env.FAKE_PY_NO_MODEL = "1";
  await assert.rejects(installHeadroom(quiet));
  delete process.env.FAKE_PY_NO_MODEL;
  const bin = join(FIXTURES, "bin");
  const r = spawnSync(process.execPath, [CLI, "--install-savers", "--with-headroom", "--yes", "--no-savers", "--since", "2026-09-01", "--until", "2026-09-30"], {
    env: {
      PATH: [join(root, "pybin"), dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      HOME: root,
      SAVER_AUDIT_HOME: process.env.SAVER_AUDIT_HOME,
      FAKE_PY_LOG: process.env.FAKE_PY_LOG,
      XDG_CACHE_HOME: join(root, "cache"),
      CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT),
      CODEX_HOME,
      NO_COLOR: "1",
      // The quick savers count as installed, so nothing is downloaded.
      SAVER_AUDIT_RTK: join(bin, "rtk"),
      CAVEMAN_ENGINE_BIN: join(bin, "caveman-engine"),
      SAVER_AUDIT_TOKEN_SAVER: join(bin, "fake-trim"),
      SAVER_AUDIT_LEAN_CTX: join(bin, "fake-trim"),
    },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /headroom 0\.38\.0 \+ its model: installed/);
  assert.equal(headroomIncomplete(), false);
});
