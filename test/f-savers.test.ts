// Version probes and --check-saver run a saver the way a replay does: the manifest's
// environment, a temporary state folder, never the user's home.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileResult } from "../src/audit.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { detectReplayTools, runReplays } from "../src/savers/replay.ts";
import type { ReplayJob } from "../src/savers/types.ts";
import { SAVERS } from "../src/savers/registry.ts";
import { withEnv } from "./env.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const BIN = fileURLToPath(new URL("./fixtures/bin/", import.meta.url));
const temps: string[] = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A scratch folder with its own temporary folder ("tmp") in it. */
function scratch(): { dir: string; temp: string; log: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sa-f-savers-")));
  temps.push(dir);
  mkdirSync(join(dir, "tmp"));
  return { dir, temp: join(dir, "tmp"), log: join(dir, "runs.jsonl") };
}
const runs = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("version probes get the manifest's environment and a temporary state folder, removed after", async () => {
  const s = scratch();
  const env = { TMPDIR: s.temp, SAVER_AUDIT_LEAN_CTX: join(BIN, "fake-saver"), SAVER_AUDIT_HEADROOM_PYTHON: join(BIN, "fake-saver"), FAKE_ENV_LOG: s.log, SAVER_AUDIT_HOME: join(s.dir, "home") };
  const tools = await withEnv(env, () => detectReplayTools(SAVERS.filter((x) => x.id === "lean-ctx")));
  assert.equal(tools.get("lean-ctx")?.version, "1.0.0");
  const [version, headroom] = runs(s.log);
  assert.deepEqual(version.args, ["--version"]);
  const state = dirname(version.env.HOME);
  assert.equal(dirname(state), s.temp, "a folder in the temporary folder");
  assert.equal(version.env.HOME, join(state, "lean-ctx-home"), "lean-ctx's home from its manifest, not the user's");
  assert.equal(version.env.XDG_CONFIG_HOME, join(state, "lean-ctx-home", ".config"));
  assert.equal(version.env.CAVEMAN_HOME, join(state, "caveman"));
  assert.equal(headroom.args[0], "-c", "the headroom import probe");
  assert.equal(headroom.env.HEADROOM_WORKSPACE_DIR, join(state, "headroom"));
  assert.deepEqual(readdirSync(s.temp), [], "removed after detection");
});

/** --check-saver on a manifest written to the scratch folder. */
function check(s: { dir: string; temp: string; log: string }, manifest: object, bin = "fake-saver") {
  const file = join(s.dir, "my-saver.json");
  writeFileSync(file, JSON.stringify({ id: "my-saver", name: "my saver", repo: "https://example.invalid/my-saver", version: "1.0.0", licence: "MIT", method: "replayed", covers: "shell output", binary: "my-saver", binaryEnv: "SAVER_AUDIT_MY_SAVER", ...manifest }));
  const env = { PATH: process.env.PATH, HOME: s.dir, SAVER_AUDIT_HOME: join(s.dir, "home"), TMPDIR: s.temp, SAVER_AUDIT_MY_SAVER: join(BIN, bin), FAKE_ENV_LOG: s.log, CAVEMAN_HOME: join(s.dir, "users-caveman") };
  return spawnSync(process.execPath, [CLI, "--check-saver", file], { env, cwd: s.dir, encoding: "utf8" });
}

test("--check-saver runs the program as a replay would: a sample command, the manifest's environment, a state folder", () => {
  const s = scratch();
  const r = check(s, { versionArgs: ["--version"], env: { HOME: "{state}/my-home", MY_STATE: "{state}/my-saver" }, routes: [{ match: { categories: ["Shell"] }, args: ["compress", "{command}"] }] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /sample command for "\{command\}": pytest -q\n/);
  assert.match(r.stdout, /sample run ok: /);
  const [version, sample] = runs(s.log);
  assert.deepEqual(sample.args, ["compress", "pytest -q"], "not a literal {command}");
  const state = dirname(sample.env.MY_STATE);
  assert.equal(dirname(state), s.temp);
  assert.equal(sample.env.HOME, join(state, "my-home"), "not the user's home");
  assert.equal(sample.env.CAVEMAN_HOME, join(state, "caveman"), "not the user's caveman store");
  assert.equal(sample.cwd, join(state, "empty"), "in an empty folder, as replays run");
  assert.deepEqual([sample.env.DO_NOT_TRACK, sample.env.HTTPS_PROXY], ["1", "http://127.0.0.1:9"]);
  assert.match(version.env.HOME, /\/my-home$/, "the version probe too");
  assert.notEqual(version.env.HOME, s.dir);
  assert.deepEqual(readdirSync(s.temp), [], "state folders removed");
});

test("--check-saver fails a jsonRatio saver whose output has no counts, as its replays would", () => {
  const s = scratch();
  const r = check(s, { jsonRatio: { before: "original_tokens", after: "compressed_tokens" }, routes: [{ args: [] }] }, "fake-trim");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /sample run failed: its output is not JSON with numbers in "original_tokens" and "compressed_tokens" \(jsonRatio\)\n/);
  assert.doesNotMatch(r.stdout, /sample run ok/);
});

test("--check-saver lists a taken id: never says to install a manifest the audit would skip", () => {
  const s = scratch();
  // Written as code: no manifest can have these ids, as a user's or a built-in one.
  for (const id of ["headroom", "caveman-skill"]) {
    const r = check(s, { id, routes: [{ args: [] }] }, "fake-trim");
    assert.equal(r.status, 1, id);
    assert.match(r.stdout, new RegExp(`- id "${id}" is already taken by a built-in saver\\n`));
    assert.doesNotMatch(r.stdout, /copy the file into/);
  }
  // A built-in manifest's id: the check still runs (a change to src/savers/builtin/rtk.json).
  const r = check(s, { id: "rtk", routes: [{ args: [] }] }, "fake-trim");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /sample run ok: /);
  assert.match(r.stdout, /id "rtk" is already taken by a built-in saver, so a copy in ~\/\.saver-audit\/savers\/ would be skipped/);
  assert.doesNotMatch(r.stdout, /copy the file into/);
});

test("--check-saver lists a taken id with the manifest's other problems, not only after they are fixed", () => {
  const s = scratch();
  const r = check(s, { id: "headroom", repo: undefined, licence: undefined, routes: [{ args: [] }] }, "fake-trim");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /: 3 problem\(s\)\n/);
  assert.match(r.stdout, /- repo: required\n/);
  assert.match(r.stdout, /- licence: required\n/);
  assert.match(r.stdout, /- id "headroom" is already taken by a built-in saver\n/);
  // A value that is not an object has no id to look up.
  const file = join(s.dir, "null.json");
  writeFileSync(file, "null");
  const n = spawnSync(process.execPath, [CLI, "--check-saver", file], { env: { PATH: process.env.PATH, HOME: s.dir, SAVER_AUDIT_HOME: join(s.dir, "home"), TMPDIR: s.temp }, cwd: s.dir, encoding: "utf8" });
  assert.equal(n.status, 1, n.stderr);
  assert.match(n.stdout, /: 1 problem\(s\)\n {2}- not a JSON object\n/);
});

test("the installer's own copy that fails its version probe counts as not installed; a user's own is still used", { skip: process.platform === "win32" ? "needs a script as the program" : false }, async () => {
  const s = scratch();
  const bin = join(s.dir, "home", "tools", "bin");
  const path = join(s.dir, "path");
  mkdirSync(bin, { recursive: true });
  mkdirSync(path);
  const detect = () => withEnv({ TMPDIR: s.temp, HOME: s.dir, SAVER_AUDIT_HOME: join(s.dir, "home"), PATH: path, SAVER_AUDIT_RTK: undefined }, () => detectReplayTools(SAVERS.filter((x) => x.id === "rtk")));
  const rtk = join(bin, "rtk");
  // Exits non-zero (e.g. its interpreter is gone), or cannot run at all (truncated, another CPU).
  for (const body of ["#!/bin/sh\nexit 1\n", "\u0000\u0001\u0002"]) {
    writeFileSync(rtk, body, { mode: 0o755 });
    assert.equal((await detect()).has("rtk"), false, JSON.stringify(body));
  }
  writeFileSync(rtk, "#!/bin/sh\necho 'rtk 0.50.0'\n", { mode: 0o755 });
  assert.equal((await detect()).get("rtk")?.version, "0.50.0");
  // The same failing program on PATH is the user's own install: still found (its replays say why they fail).
  rmSync(rtk);
  writeFileSync(join(path, "rtk"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.deepEqual((await detect()).get("rtk"), { saver: "rtk", command: join(path, "rtk"), version: undefined });
});

test("a relative saver path is found as an absolute one, so replays in their empty folder can start it", { skip: process.platform === "win32" ? "needs a script as the program" : false }, async () => {
  const s = scratch();
  for (const d of ["bin", "node", join("nm", ".bin")]) mkdirSync(join(s.dir, d), { recursive: true });
  for (const f of ["caveman-engine", "headroom-python"]) copyFileSync(join(BIN, f), join(s.dir, "bin", f));
  copyFileSync(join(BIN, "rtk"), join(s.dir, "nm", ".bin", "rtk"));
  symlinkSync(process.execPath, join(s.dir, "node", "node")); // the fakes' `#!/usr/bin/env node`
  const env = { TMPDIR: s.temp, HOME: s.dir, SAVER_AUDIT_HOME: join(s.dir, "home"), PATH: ["nm/.bin", join(s.dir, "node")].join(delimiter), SAVER_AUDIT_RTK: undefined, CAVEMAN_ENGINE_BIN: "./bin/caveman-engine", SAVER_AUDIT_HEADROOM_PYTHON: "bin/headroom-python" };
  const synth = (saver: string, input: string, args?: string[]): FileResult => {
    const job: ReplayJob = { saver, tool: "Bash", cls: "Shell|tests", baseline: countProxy(input), headerTokens: 0, addTokens: 0, timeline: "main", block: 0, key: "k0", input, args };
    return { file: "f", source: "claude-code", records: [], skippedLines: 0, savers: { timelines: { main: { blocks: [{ d: [0] }] } }, jobs: [job], covered: [0], toolTokens: 0 } };
  };
  const cwd = process.cwd();
  process.chdir(s.dir);
  try {
    await withEnv(env, async () => {
      const tools = detectReplayTools(SAVERS.filter((x) => x.id === "rtk" || x.id === "caveman-engine"));
      assert.equal(tools.get("caveman-engine")?.command, join(s.dir, "bin", "caveman-engine"), "an override, from the current folder");
      assert.equal(tools.get("headroom")?.command, join(s.dir, "bin", "headroom-python"), "SAVER_AUDIT_HEADROOM_PYTHON, from the current folder");
      assert.equal(tools.has("rtk"), false, "a relative PATH folder is not searched");
      const warnings: string[] = [];
      for (const [saver, args] of [["caveman-engine", ["compress"]], ["headroom", undefined]] as const) {
        const stats = await runReplays([synth(saver, "x".repeat(4000), args && [...args])], [saver], { tools, full: true, concurrency: 1, warn: (w) => warnings.push(w) });
        assert.deepEqual([stats.get(saver)?.ran, stats.get(saver)?.failed], [1, 0], saver);
      }
      assert.deepEqual(warnings, []);
    });
  } finally {
    process.chdir(cwd);
  }
});
