import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLAUDE_ROOT, CODEX_HOME, SECRET } from "./helpers.ts";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const BIN = fileURLToPath(new URL("./fixtures/bin/", import.meta.url));
// Savers on: the fake saver binaries replay the fixtures, so the saver section is
// covered by the privacy checks too.
const SAVER_ENV = {
  SAVER_AUDIT_RTK: join(BIN, "rtk"),
  CAVEMAN_ENGINE_BIN: join(BIN, "caveman-engine"),
  SAVER_AUDIT_HEADROOM_PYTHON: join(BIN, "headroom-python"),
};

function run(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, "--since", "2026-09-01", ...args], {
    env: { ...process.env, ...SAVER_ENV, CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME, HOME: "/nonexistent", XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), "sa-priv-")), NO_COLOR: "1" },
    encoding: "utf8",
  });
}

test("default terminal report holds no text, paths, commands or project names from logs", () => {
  const out = run();
  assert.match(out, /API-equivalent/);
  assert.match(out, /What each token saver would have cut/);
  assert.match(out, /rtk\s+replayed/);
  assert.doesNotMatch(out, SECRET);
});

test("--json holds no text, paths, commands or project names from logs", () => {
  const out = run("--json");
  JSON.parse(out);
  assert.doesNotMatch(out, SECRET);
});

test("--show-projects is the only way project names appear", () => {
  assert.match(run("--show-projects"), /SECRET-project-alpha/);
});

test("no logs: exit 0 and say where it looked", () => {
  const out = execFileSync(process.execPath, [CLI], { env: { ...process.env, CLAUDE_CONFIG_DIR: "/nonexistent/claude", CODEX_HOME: "/nonexistent/codex", HOME: "/nonexistent" }, encoding: "utf8" });
  assert.match(out, /No agent API calls found/);
  assert.match(out, /\/nonexistent\/claude\/projects/);
});
