import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lastSegment, loadManifests, routeMatches, validateManifest } from "../src/savers/manifest.ts";
import type { OutputView } from "../src/savers/types.ts";

const BIN = fileURLToPath(new URL("./fixtures/bin/", import.meta.url));
const view = (over: Partial<OutputView>): OutputView => ({ source: "claude-code", tool: "Bash", category: "Shell", family: "tests", text: "x", tokens: 1, ...over });

export const COMMUNITY = {
  id: "fake-trim",
  name: "fake trim",
  repo: "https://example.invalid/fake-trim",
  version: "1.0.0",
  licence: "MIT",
  method: "replayed",
  covers: "test output",
  stage: "tool",
  binary: "fake-trim",
  binaryEnv: "SAVER_AUDIT_FAKE_TRIM",
  routes: [{ name: "tests", match: { families: ["tests"] }, args: [] }],
};

test("manifest validation explains what is wrong", () => {
  assert.deepEqual(validateManifest(COMMUNITY), []);
  const bad = validateManifest({ id: "Bad Id", method: "modeled", routes: [{ match: { command: "(" } }] });
  assert.ok(bad.some((p) => p.startsWith("id:")));
  assert.ok(bad.some((p) => p.startsWith("method:")), "modeled savers are not accepted as manifests");
  assert.ok(bad.some((p) => p.startsWith("repo:")));
  assert.deepEqual(validateManifest({ ...COMMUNITY, method: "upper-bound", assumption: undefined }).filter((p) => p.startsWith("assumption")).length, 1);
  assert.ok(validateManifest({ ...COMMUNITY, routes: [{ match: { command: "(" }, args: [] }] }).some((p) => p.includes("regular expression")));
});

test("routes match on tool, category, family, command and size", () => {
  assert.equal(lastSegment("cd /x && FOO=1 pytest -q | tail -5"), "pytest -q");
  assert.equal(routeMatches({ command: "^pytest\\b" }, view({ command: "cd a && pytest" })), true);
  assert.equal(routeMatches({ command: "^pytest\\b" }, view({ command: "npm test" })), false);
  assert.equal(routeMatches({ tools: ["Read"] }, view({})), false);
  assert.equal(routeMatches({ excludeTools: ["Bash"] }, view({})), false);
  assert.equal(routeMatches({ minBytes: 3 }, view({ text: "abcd" })), true);
  assert.equal(routeMatches({ minBytes: 4 }, view({ text: "abcd" })), false);
  assert.equal(routeMatches(undefined, view({})), true);
});

test("user manifests load next to the built-ins; bad or clashing ones are reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-manifests-"));
  try {
    writeFileSync(join(dir, "good.json"), JSON.stringify(COMMUNITY));
    writeFileSync(join(dir, "clash.json"), JSON.stringify({ ...COMMUNITY, id: "rtk" }));
    writeFileSync(join(dir, "broken.json"), "{not json");
    // Without built-ins nothing clashes; files load in name order.
    assert.deepEqual(loadManifests([], dir).manifests.map((m) => m.id), ["rtk", "fake-trim"]);
    const r2 = loadManifests([{ ...COMMUNITY, id: "rtk" } as never], dir);
    assert.deepEqual(r2.manifests.map((m) => m.id), ["rtk", "fake-trim"]);
    assert.ok(r2.problems.some((p) => p.startsWith("clash.json: id \"rtk\" is already taken")));
    assert.ok(r2.problems.some((p) => p.startsWith("broken.json: not valid JSON")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a community saver is replayed and reported like a built-in one", async () => {
  const home = mkdtempSync(join(tmpdir(), "sa-home-"));
  try {
    mkdirSync(join(home, "savers"), { recursive: true });
    writeFileSync(join(home, "savers", "fake-trim.json"), JSON.stringify(COMMUNITY));
    const { execFileSync } = await import("node:child_process");
    const { CLAUDE_ROOT, CODEX_HOME } = await import("./helpers.ts");
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const out = execFileSync(process.execPath, [cli, "--since", "2026-09-01", "--until", "2026-09-30", "--savers", "fake-trim", "--json"], {
      env: { ...process.env, SAVER_AUDIT_HOME: home, SAVER_AUDIT_FAKE_TRIM: join(BIN, "fake-trim"), CLAUDE_CONFIG_DIR: join(CLAUDE_ROOT, ".."), CODEX_HOME, XDG_CACHE_HOME: join(home, "cache"), HOME: "/nonexistent" },
      encoding: "utf8",
    });
    const row = JSON.parse(out).savers.find((s: { id: string }) => s.id === "fake-trim");
    assert.equal(row.method, "replayed");
    assert.equal(row.status, "ok");
    assert.ok(row.cost > 0, "the pytest output was trimmed");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
