// Replay messages that tell the user what to do next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FileResult } from "../src/audit.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { runReplays } from "../src/savers/replay.ts";
import { toolPaths } from "../src/savers/toolsdir.ts";
import type { ReplayJob } from "../src/savers/types.ts";
import { withEnv } from "./env.ts";
import { FIXTURES } from "./helpers.ts";

/** One synthetic log file whose outputs are replay jobs for `saver`. */
function synth(saver: string, inputs: string[]): FileResult {
  const jobs = inputs.map((input, i): ReplayJob => ({ saver, tool: "Bash", cls: "Shell|tests", baseline: countProxy(input), headerTokens: 0, addTokens: 0, timeline: "main", block: i, key: `k${i}`, input }));
  return { file: "f", source: "claude-code", records: [], skippedLines: 0, savers: { timelines: { main: { blocks: jobs.map(() => ({ d: [0], r: [0] })) } }, jobs, covered: [0], toolTokens: 0 } };
}

test("headroom without its model: the installer's own copy is finished by the installer, another is run once online", { skip: process.platform === "win32" ? "needs a script as the Python" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-e2-"));
  try {
    await withEnv({ SAVER_AUDIT_HOME: join(dir, "home") }, async () => {
      // The fake sidecar in the tools folder's venv, where --install-savers puts headroom.
      mkdirSync(dirname(toolPaths.headroomPython()), { recursive: true });
      copyFileSync(join(FIXTURES, "bin", "fake-headroom"), toolPaths.headroomPython());
      const warnings: string[] = [];
      const run = (command: string) => runReplays([synth("headroom", ["x".repeat(4000)])], ["headroom"], { tools: new Map([["headroom", { saver: "headroom", command, env: { FAKE_READY: "0" } }]]), full: true, concurrency: 1, warn: (s) => warnings.push(s) });
      await run(toolPaths.headroomPython());
      await run(join(FIXTURES, "bin", "fake-headroom"));
      assert.deepEqual(warnings, [
        "headroom: its compression model is not cached; skipped (finish its install with: npx saver-audit --install-savers --with-headroom).",
        "headroom: its compression model is not cached; skipped (run headroom once online to download it).",
      ]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
