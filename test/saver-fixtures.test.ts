import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SAVERS, manifestAdapter } from "../src/savers/registry.ts";
import { detectReplayTools } from "../src/savers/replay.ts";

// Each test/fixtures/savers/<id>/ holds input.txt, expected.txt and (for shell savers)
// command.txt. The fixture runs through the real saver when it is installed; otherwise
// the test is skipped, so contributors can check their manifest and CI stays green.
const dir = fileURLToPath(new URL("./fixtures/savers/", import.meta.url));

for (const id of existsSync(dir) ? readdirSync(dir) : []) {
  test(`saver fixture: ${id}`, (t) => {
    const saver = SAVERS.find((s) => s.id === id);
    assert.ok(saver?.manifest, `no built-in manifest for fixture "${id}"`);
    const tool = detectReplayTools([manifestAdapter(saver.manifest)]).get(id);
    if (!tool) return t.skip(`${saver.manifest.binary} not installed`);
    const input = readFileSync(`${dir}${id}/input.txt`, "utf8");
    const command = existsSync(`${dir}${id}/command.txt`) ? readFileSync(`${dir}${id}/command.txt`, "utf8").trim() : undefined;
    const view = { source: "claude-code" as const, tool: "Bash", category: "Shell", family: "tests", command, text: input, tokens: 1000 };
    assert.ok(saver.appliesTo(view), "the manifest's routes should match this fixture");
    const job = saver.replayInput!(view)!;
    const r = spawnSync(tool.command, job.args ?? [], { input: job.input, encoding: "utf8", env: { ...process.env, DO_NOT_TRACK: "1" } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, readFileSync(`${dir}${id}/expected.txt`, "utf8"));
  });
}
