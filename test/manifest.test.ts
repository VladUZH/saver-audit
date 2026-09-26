import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lastSegment, loadManifests, routeMatches, validateManifest } from "../src/savers/manifest.ts";
import type { OutputView } from "../src/savers/types.ts";
import { withEnv } from "./env.ts";

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

test("manifest validation checks the type of every field used later", async () => {
  const { SAVERS } = await import("../src/savers/registry.ts");
  for (const s of SAVERS) if (s.manifest) assert.deepEqual(validateManifest(s.manifest), [], s.id);
  const route = COMMUNITY.routes[0]!;
  const cases: Array<[string, object]> = [
    ["routes[0].args: a list of strings", { routes: [{ ...route, args: ["--level", 2] }] }],
    ["paths: a list of strings", { paths: "~/x/bin" }],
    ["versionArgs: a list of strings", { versionArgs: "--version" }],
    ["routes[0].match.families: a list of strings", { routes: [{ ...route, match: { families: "tests" } }] }],
    ["routes[0].match.minBytes: a number", { routes: [{ ...route, match: { minBytes: "5000" } }] }],
    ["routes[0].match: an object", { routes: [{ ...route, match: ["tests"] }] }],
    ["routes[0]: an object", { routes: [null] }],
    ["binaryEnv: a string", { binaryEnv: 1 }],
    ["minTokens: a number", { minTokens: "1000" }],
    ["codexHypothetical: true or false", { codexHypothetical: "no" }],
  ];
  const dir = mkdtempSync(join(tmpdir(), "sa-manifests-"));
  try {
    for (const [problem, over] of cases) {
      assert.deepEqual(validateManifest({ ...COMMUNITY, ...over }), [problem]);
      writeFileSync(join(dir, "x.json"), JSON.stringify({ ...COMMUNITY, ...over }));
      assert.deepEqual(loadManifests([], dir).manifests, [], `skipped: ${problem}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("routes match on tool, category, family, command and size", () => {
  assert.equal(lastSegment("cd /x && FOO=1 pytest -q | tail -5"), "pytest -q | tail -5");
  assert.equal(routeMatches({ command: "^pytest\\b" }, view({ command: "cd a && pytest" })), true);
  assert.equal(routeMatches({ command: "^pytest\\b" }, view({ command: "npm test" })), false);
  assert.equal(routeMatches({ tools: ["Read"] }, view({})), false);
  assert.equal(routeMatches({ excludeTools: ["Bash"] }, view({})), false);
  assert.equal(routeMatches({ minBytes: 3 }, view({ text: "abcd" })), true);
  assert.equal(routeMatches({ minBytes: 4 }, view({ text: "abcd" })), false);
  assert.equal(routeMatches(undefined, view({})), true);
});

test("the last segment is the program rtk's hook would rewrite: past what it looks past, and nothing else", () => {
  const cases: Array<[string, string | undefined]> = [
    ["nice -n 10 make", "make"],
    ["nice -5 pytest -q", "pytest -q"],
    ["timeout -s KILL 60 cargo test", "cargo test"],
    ["timeout 60 pytest -q", "pytest -q"],
    ["timeout -k5s 60 cargo test", "cargo test"],
    ["timeout --kill-after=5s 60 cargo test", "cargo test"],
    ["timeout -- 60 cargo test", "cargo test"],
    ["/usr/bin/timeout 60 cargo test", "cargo test"],
    ["time -p pytest -q", "pytest -q"],
    ["nohup pytest -q", "pytest -q"],
    ["time CI=1 pytest -q", "pytest -q"],
    ["env CI=1 nice -n 5 pytest -q", "pytest -q"],
    ["command rg foo", "rg foo"],
    ["exec pytest -q", "pytest -q"],
    ["(cd web && npm test)", "npm test"],
    // rtk leaves these as they are, so no route anchored on the program matches them.
    ["sudo -u www git pull", "sudo -u www git pull"],
    ["sudo git diff", "sudo git diff"],
    ["timeout 60 sudo pytest -q", "sudo pytest -q"],
    ["xargs -n 1 grep foo", "xargs -n 1 grep foo"],
    ["env -u HOME CI=1 vitest run", "env -u HOME CI=1 vitest run"],
    ["command -v rg", "command -v rg"],
    ["timeout --unknown 60 cargo test", "timeout --unknown 60 cargo test"],
    ["(pytest -q)", "(pytest -q)"],
    ["make && (npm test)", "(npm test)"],
    ["{ make; }", "{ make"],
    ["cd web && sudo", "sudo"],
    // In a pipeline: a final grep or rg, or the first program with the stages that only pass its output through.
    ["pytest -q 2>&1 | grep FAILED", "grep FAILED"],
    ["pytest -q | timeout 5 grep FAIL", "grep FAIL"],
    ["timeout 60 pytest -q 2>&1 | tail -5", "pytest -q 2>&1 | tail -5"],
    ["make || pytest -q | tail -5 # it's fine", "pytest -q | tail -5 # it's fine"],
    ["grep -E \"a|b\" src; true", "grep -E \"a|b\" src"],
    ["echo \"a && b\" && git diff", "git diff"],
    ["pytest -q | wc -l", undefined],
    ["pytest -q | tail -F", undefined],
    ["pytest -q | tail --follow=name", undefined],
    ["pytest -q | | tail", undefined],
    ["git diff | head; (cd x && pytest)", undefined],
    ["cat $(ls)", undefined],
    ["pytest -q \"$(cat args)\"", undefined],
    ["grep \"\\$(x)\" src", "grep \"\\$(x)\" src"],
  ];
  for (const [command, seg] of cases) assert.equal(lastSegment(command), seg, command);
  // So a route anchored on the program matches only what rtk rewrites.
  assert.equal(routeMatches({ command: "^cargo test\\b" }, view({ command: "timeout -s KILL 60 cargo test" })), true);
  assert.equal(routeMatches({ command: "^git (diff|show)\\b" }, view({ command: "sudo -u www git diff" })), false);
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

test("a user manifest cannot take the id of a saver written as code (headroom)", async () => {
  const home = mkdtempSync(join(tmpdir(), "sa-home-"));
  try {
    mkdirSync(join(home, "savers"));
    writeFileSync(join(home, "savers", "headroom.json"), JSON.stringify({ ...COMMUNITY, id: "headroom" }));
    const { execFileSync } = await import("node:child_process");
    const registry = new URL("../src/savers/registry.ts", import.meta.url).href;
    const script = `const { allSavers } = await import(${JSON.stringify(registry)}); const a = allSavers(); console.log(JSON.stringify({ problems: a.problems, headroom: a.savers.filter((s) => s.id === "headroom").map((s) => s.manifest ? "manifest" : "code") }));`;
    const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, SAVER_AUDIT_HOME: home }, encoding: "utf8" }));
    assert.deepEqual(out, { problems: ['headroom.json: id "headroom" is already taken'], headroom: ["code"] });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a binary name with regular-expression characters is found and its version read", async () => {
  const { manifestAdapter } = await import("../src/savers/registry.ts");
  const { detectReplayTools } = await import("../src/savers/replay.ts");
  const dir = mkdtempSync(join(tmpdir(), "sa-bin-"));
  try {
    const bin = join(dir, "trim++");
    writeFileSync(bin, '#!/usr/bin/env node\nconsole.log("trim++ 1.0.0");\n', { mode: 0o755 });
    const m = { ...COMMUNITY, id: "trimpp", binary: "trim++", binaryEnv: "SAVER_AUDIT_TRIMPP", versionArgs: ["--version"] };
    assert.deepEqual(validateManifest(m), []);
    const found = await withEnv({ SAVER_AUDIT_TRIMPP: bin, SAVER_AUDIT_HOME: dir, SAVER_AUDIT_HEADROOM_PYTHON: "" }, () => detectReplayTools([manifestAdapter(m as never)]));
    assert.deepEqual([...found.values()], [{ saver: "trimpp", command: bin, version: "1.0.0" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the version number is read from lines like 'token-saver v3.0.0' and 'lean-ctx 3.10.3 (official, …)'", async () => {
  const { saverIndex } = await import("../src/savers/registry.ts");
  const { detectReplayTools } = await import("../src/savers/replay.ts");
  const { keyVersion } = await import("../src/savers/tracker.ts");
  const { renderTerminal } = await import("../src/report/terminal.ts");
  const dir = mkdtempSync(join(tmpdir(), "sa-bin-"));
  try {
    const fake = (file: string, line: string) => {
      writeFileSync(join(dir, file), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(line)});\n`, { mode: 0o755 });
      return join(dir, file);
    };
    const env = {
      SAVER_AUDIT_TOKEN_SAVER: fake("token-saver", "token-saver v3.0.0"),
      SAVER_AUDIT_LEAN_CTX: fake("lean-ctx", "lean-ctx 3.10.3 (official, https://github.com/yvgude/lean-ctx)"),
      SAVER_AUDIT_HOME: dir,
      SAVER_AUDIT_HEADROOM_PYTHON: "",
    };
    const adapters = saverIndex(["token-saver", "lean-ctx"]);
    const found = await withEnv(env, () => detectReplayTools(adapters));
    assert.equal(found.get("token-saver")?.version, "3.0.0");
    assert.equal(found.get("lean-ctx")?.version, "3.10.3");
    for (const a of adapters) assert.equal(keyVersion(a.version, found.get(a.id)?.version), a.version, `${a.id} keeps the adapter's cache key`);
    const { runAudit } = await import("../src/pool.ts");
    const { fixtureOptions } = await import("./helpers.ts");
    const r = await runAudit(fixtureOptions(), undefined, 1, { ids: adapters.map((a) => a.id), tools: found, cacheFile: join(dir, "c.json") });
    assert.doesNotMatch(renderTerminal(r, { showProjects: false, verbose: false, color: false }), /this adapter was written for/);
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

test("{command} in a route's args passes the recorded command and keys the cache by it", async () => {
  const { manifestAdapter } = await import("../src/savers/registry.ts");
  const a = manifestAdapter({ ...COMMUNITY, routes: [{ name: "any", match: { categories: ["Shell"] }, args: ["compress", "{command}"] }] } as never);
  const r1 = a.replayInput!(view({ command: "pytest -q" }))!;
  const r2 = a.replayInput!(view({ command: "go test ./..." }))!;
  assert.deepEqual(r1.args, ["compress", "pytest -q"]);
  assert.notEqual(r1.arg, r2.arg, "different commands, different cache keys");
  assert.equal(a.replayInput!(view({ command: undefined })), undefined, "no command, no replay");
  const odd = "echo $$ && IFS=$'\\n' x \"$&\" $` $'";
  assert.deepEqual(a.replayInput!(view({ command: odd }))!.args, ["compress", odd], "passed literally ($$, $&, $` and $' are not patterns)");
  const plain = manifestAdapter(COMMUNITY as never).replayInput!(view({ command: "pytest" }))!;
  assert.equal(plain.arg, "tests", "savers without {command} keep their cache keys");
});

test("jsonRatio: a saver's own before/after counts scale saver-audit's count", async () => {
  const { ratioResult } = await import("../src/savers/replay.ts");
  const f = { before: "original_tokens", after: "compressed_tokens", afterBytes: "compressed_bytes" };
  assert.deepEqual(ratioResult(JSON.stringify({ original_tokens: 1000, compressed_tokens: 250, compressed_bytes: 1000 }), f, 800), { t: 200, c: 1000, p: 200 });
  const big = ratioResult(JSON.stringify({ original_tokens: 100, compressed_tokens: 100, compressed_bytes: 40_000 }), f, 10_000)!;
  assert.equal(big.p, 500, "first 2,000 of 40,000 chars ≈ 5% of the tokens");
  assert.equal(ratioResult("not json", f, 10), undefined);
  assert.equal(ratioResult(JSON.stringify({ original_tokens: 0, compressed_tokens: 0 }), f, 10), undefined);
});
