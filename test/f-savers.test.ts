// Version probes run a saver the way a replay does: the manifest's environment, a
// temporary state folder, never the user's home.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectReplayTools } from "../src/savers/replay.ts";
import { SAVERS } from "../src/savers/registry.ts";
import { withEnv } from "./env.ts";

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
