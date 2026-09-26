// The installer's own programs and folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { headroomIncomplete, installHeadroom } from "../src/savers/install.ts";
import { userSaversDir } from "../src/savers/manifest.ts";
import { findPython, installPlan, onPathOnly, toolsDir } from "../src/savers/toolsdir.ts";
import { withEnv } from "./env.ts";
import { FIXTURES } from "./helpers.ts";

const unix = process.platform === "win32" ? "needs sh" : false;

test("programs are found in PATH's absolute folders only, never in the current folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-path-"));
  const cwd = process.cwd();
  try {
    mkdirSync(join(dir, "here", "rel"), { recursive: true });
    mkdirSync(join(dir, "bin"));
    // A planted copy in the current folder and in a relative PATH entry.
    writeFileSync(join(dir, "here", "py.exe"), "");
    writeFileSync(join(dir, "here", "rel", "py.exe"), "");
    process.chdir(join(dir, "here"));
    await withEnv({ PATH: ["", ".", "rel", join(dir, "bin")].join(delimiter) }, () => {
      assert.equal(onPathOnly("py.exe"), undefined);
      writeFileSync(join(dir, "bin", "py.exe"), "");
      assert.equal(onPathOnly("py.exe"), join(dir, "bin", "py.exe"));
    });
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty SAVER_AUDIT_HOME counts as unset: tools and manifests stay in ~/.saver-audit", async () => {
  await withEnv({ SAVER_AUDIT_HOME: "" }, () => {
    assert.equal(toolsDir(), join(homedir(), ".saver-audit", "tools"));
    assert.equal(userSaversDir(), join(homedir(), ".saver-audit", "savers"));
  });
});

test("lean-ctx is not offered on Windows, where its settings cannot be kept apart from the user's", () => {
  const win = installPlan("win32", "x64", null).find((c) => c.id === "lean-ctx")!;
  assert.deepEqual({ available: win.available, why: win.why }, { available: false, why: "its settings cannot be kept apart from yours on Windows" });
  for (const platform of ["darwin", "linux"]) assert.equal(installPlan(platform, "x64", null).find((c) => c.id === "lean-ctx")!.available, true, platform);
});

test("the headroom install runs Python in the tools folder, never where saver-audit was started", { skip: unix }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-hr-cwd-"));
  const cwd = process.cwd();
  try {
    mkdirSync(join(dir, "pybin"));
    copyFileSync(join(FIXTURES, "installer", "fake-python"), join(dir, "pybin", "python3"));
    chmodSync(join(dir, "pybin", "python3"), 0o755);
    mkdirSync(join(dir, "project"));
    process.chdir(join(dir, "project"));
    const log = join(dir, "cwd.log");
    await withEnv({ PATH: [join(dir, "pybin"), "/usr/bin", "/bin"].join(delimiter), SAVER_AUDIT_HOME: join(dir, "home"), FAKE_PY_LOG: join(dir, "calls.log"), FAKE_PY_CWD_LOG: log }, async () => {
      await installHeadroom(() => {});
      assert.equal(headroomIncomplete(), false);
      // findPython's version probe runs where it is started (it imports nothing but sys).
      const steps = readFileSync(log, "utf8").trim().split("\n").map((l) => l.split("|")).filter(([what]) => !what!.includes("sys.version_info"));
      const label = (what: string) => (/^-m (venv|pip)/.exec(what)?.[1] ?? (what.includes("prefetch") ? "model" : "ready check"));
      assert.deepEqual(steps.map(([what]) => label(what!)), ["venv", "pip", "model", "ready check"]);
      for (const [what, where] of steps) assert.equal(where, realpathSync(toolsDir()), what);
      for (const [what, , safe] of steps) assert.equal(safe, "1", `PYTHONSAFEPATH for ${what}`);
      for (const [what] of steps.slice(2)) assert.match(what!, /^-c\s+import sys; sys\.path\[:\] = \[p for p in sys\.path if p\]/, "drops the current folder first");
    });
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checking Python's venv module never imports a venv.py from the current folder", { skip: unix }, async (c) => {
  const py = findPython();
  if (!py) return c.skip("no Python 3.10+ here");
  const dir = mkdtempSync(join(tmpdir(), "sa-venv-"));
  const cwd = process.cwd();
  try {
    const marker = join(dir, "imported");
    for (const mod of ["venv", "ensurepip"]) writeFileSync(join(dir, `${mod}.py`), `open(${JSON.stringify(marker)}, "w").close()\n`);
    process.chdir(dir);
    installPlan(process.platform, process.arch, py);
    assert.equal(existsSync(marker), false);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
