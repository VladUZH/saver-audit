// The CLI's period and --jobs flags, run on the fixtures.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJobs } from "../src/args.ts";
import { runAudit } from "../src/pool.ts";
import { CLAUDE_ROOT, CODEX_HOME, fixtureOptions } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const temps: string[] = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** The CLI on the fixtures, in an empty folder with its own home. */
function cli(args: string[]) {
  const root = mkdtempSync(join(tmpdir(), "sa-f-"));
  temps.push(root);
  const env = { PATH: process.env.PATH, HOME: root, SAVER_AUDIT_HOME: join(root, "home"), XDG_CACHE_HOME: join(root, "cache"), CLAUDE_CONFIG_DIR: dirname(CLAUDE_ROOT), CODEX_HOME };
  return spawnSync(process.execPath, [CLI, "--no-savers", "--no-card", ...args], { env, cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test("--last with --until audits the days before --until, not the days before today", () => {
  const r = cli(["--json", "--until", "2026-09-24T00:00:00Z", "--last", "2d"]);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.period, { since: "2026-09-22T00:00:00.000Z", until: "2026-09-24T00:00:00.000Z" });
  assert.ok(j.calls > 0, "the fixtures' calls on 2026-09-23 are in it");
});

test("a --since after --until is an error, not an empty report", () => {
  const r = cli(["--since", "2026-09-25", "--until", "2026-09-01"]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "saver-audit: --since 2026-09-25 is after --until 2026-09-01\n");
  assert.equal(r.stdout, "");
});

test("--jobs takes a whole number of at least 1; anything else is an error, not a crash", () => {
  assert.equal(parseJobs(undefined), undefined);
  assert.equal(parseJobs("4"), 4);
  for (const v of ["abc", "0", "-2", "2.5", ""]) assert.throws(() => parseJobs(v), { message: `--jobs: expected a whole number of at least 1, got ${v}` }, v);
  const r = cli(["--json", "--jobs", "abc"]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "saver-audit: --jobs: expected a whole number of at least 1, got abc\n");
});

test("a worker count that is not a number reads every file on one thread", async () => {
  const one = await runAudit(fixtureOptions(), undefined, 1);
  // The worker entry is the CLI module, as in the CLI; not imported here.
  assert.deepEqual(await runAudit(fixtureOptions(), new URL("../src/cli.ts", import.meta.url), NaN), one);
});
