// The installer's own programs and folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { userSaversDir } from "../src/savers/manifest.ts";
import { installPlan, onPathOnly, toolsDir } from "../src/savers/toolsdir.ts";
import { withEnv } from "./env.ts";

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
