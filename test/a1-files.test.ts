// Log discovery with symlinks and overlapping roots. Everything is built in a temp dir
// from the synthetic fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findClaudeFiles } from "../src/sources/claude-code.ts";
import { findCodexFiles } from "../src/sources/codex.ts";
import { runAudit } from "../src/pool.ts";
import { CLAUDE_ROOT, CODEX_HOME, fixtureOptions } from "./helpers.ts";

const ALPHA = "-home-dev-SECRET-project-alpha";
const BETA = "-home-dev-SECRET-project-beta";

function withDir(fn: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "sa-a1-files-"));
  const done = () => rmSync(dir, { recursive: true, force: true });
  try {
    const r = fn(dir);
    if (r instanceof Promise) return r.finally(done);
    done();
  } catch (e) {
    done();
    throw e;
  }
}

test("symlinked project folders and transcripts are followed; loops end; broken links are unreadable", () =>
  withDir(async (dir) => {
    const projects = join(dir, "projects");
    mkdirSync(join(projects, BETA), { recursive: true });
    symlinkSync(join(CLAUDE_ROOT, ALPHA), join(projects, ALPHA)); // project moved to another disk
    symlinkSync(join(CLAUDE_ROOT, BETA, "sess-2.jsonl"), join(projects, BETA, "sess-2.jsonl"));
    symlinkSync(projects, join(projects, BETA, "loop"));
    const files = findClaudeFiles([projects], 0);
    assert.deepEqual(
      files.map((f) => f.slice(projects.length)),
      [`/${ALPHA}/sess-1.jsonl`, `/${ALPHA}/sess-1/subagents/agent-a1.jsonl`, `/${BETA}/sess-2.jsonl`],
    );
    const linked = await runAudit(fixtureOptions({ sources: ["claude-code"], claudeRoots: [projects] }), undefined, 1);
    const direct = await runAudit(fixtureOptions({ sources: ["claude-code"], claudeRoots: [CLAUDE_ROOT] }), undefined, 1);
    assert.deepEqual({ ...linked, looked: [] }, { ...direct, looked: [] });

    symlinkSync(join(dir, "gone.jsonl"), join(projects, BETA, "gone.jsonl"));
    const broken = await runAudit(fixtureOptions({ sources: ["claude-code"], claudeRoots: [projects] }), undefined, 1);
    assert.equal(broken.files, 4);
    assert.equal(broken.skipped.unreadableFiles, 1, "a broken link is reported, not dropped silently");
  }));

test("a symlinked Codex day folder is followed", () =>
  withDir((dir) => {
    mkdirSync(join(dir, "sessions", "2026", "09"), { recursive: true });
    symlinkSync(join(CODEX_HOME, "sessions", "2026", "09", "20"), join(dir, "sessions", "2026", "09", "20"));
    const files = findCodexFiles(dir, 0).map((f) => f.slice(dir.length));
    assert.deepEqual(files, ["/sessions/2026/09/20/rollout-2026-09-20T10-00-00-thr1.jsonl"]);
  }));
