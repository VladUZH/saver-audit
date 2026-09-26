import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult, SaverRow } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { cardSvg } from "../src/report/card.ts";
import { shareText } from "../src/report/share.ts";
import { renderShort, renderTerminal } from "../src/report/terminal.ts";
import { CLAUDE_ROOT, FAKE_TOOLS, fixtureOptions } from "./helpers.ts";

const OPTS = { showProjects: false, verbose: false, color: false };

const amt = (tokens: number, cost: number) => ({ tokens, cost });

/** A replayed saver row with a measured number; `over` changes any field. */
function saver(id: string, name: string, cost: number, over: Partial<SaverRow> = {}): SaverRow {
  return { id, name, repo: "example/x", method: "replayed", version: "1.0.0", licence: "MIT", status: "ok", covers: "", coverage: 0.5, tokens: cost * 1e5, cost, codexCost: 0, codexHypothetical: false, ...over };
}

/** A synthetic 30-day result on Claude Code + Codex with a $312.40 total. */
function result(over: Partial<AuditResult> = {}): AuditResult {
  return {
    period: { since: "2026-08-27T12:00:00.000Z", until: "2026-09-26T12:00:00.000Z" },
    looked: [],
    sources: ["claude-code", "codex"],
    files: 40,
    sessions: { main: 40, subagent: 5, bySource: { "claude-code": 25, codex: 15 } },
    calls: 4000,
    models: [{ model: "claude-opus-5-5", pricedAs: "claude-opus-5-5", calls: 4000, tokens: 3e8, cost: 312.4 }],
    billing: { input: amt(1e6, 5), cacheWrite: amt(1e7, 50), cacheRead: amt(2.8e8, 140), output: amt(9e6, 117.4), webSearch: { requests: 0, cost: 0 }, total: amt(3e8, 312.4) },
    buckets: [{ key: "tool:Shell", label: "Tool output: Shell", group: "context", tokens: 1e8, cost: 100 }],
    waste: [],
    projects: [],
    calibration: [],
    savers: [],
    prices: { date: "2026-09-25", sources: [] },
    skipped: { lines: 0, unreadableFiles: 0, duplicateCalls: 0, outsidePeriod: 0, notBillable: 0 },
    ...over,
  };
}

/** Runs the audit on a copy of the Claude fixture whose logs went through `edit`. */
async function editedClaude(edit: (text: string) => string, tools = new Map([["rtk", FAKE_TOOLS.get("rtk")!]])): Promise<AuditResult> {
  const dir = mkdtempSync(join(tmpdir(), "sa-e1-"));
  try {
    const root = join(dir, "projects");
    cpSync(CLAUDE_ROOT, root, { recursive: true });
    for (const f of readdirSync(root, { recursive: true, encoding: "utf8" }).filter((x) => x.endsWith(".jsonl"))) {
      const p = join(root, f);
      writeFileSync(p, edit(readFileSync(p, "utf8")));
    }
    return await runAudit(fixtureOptions({ sources: ["claude-code"], claudeRoots: [root] }), undefined, 1, { ids: [...tools.keys()], tools, cacheFile: join(dir, "c.json"), full: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("calls on unpriced models are named next to the total in the short view, on the card and in the post", async () => {
  const r = await editedClaude((t) => t.replace(/"model":"claude-sonnet-5"/g, '"model":"claude-zeta-1"'));
  assert.deepEqual(r.models.filter((m) => !m.pricedAs).map((m) => [m.model, m.calls]), [["claude-zeta-1", 1]]);
  const short = renderShort(r, OPTS);
  assert.match(short, /API-equivalent at list prices[^\n]*\nExcludes 1 call on unpriced models: claude-zeta-1 \(tokens counted, \$0\)\./);
  assert.match(short, /List prices of 2026-09-25\./);
  const svg = cardSvg(r);
  assert.match(svg, /excludes 1 call on unpriced models/);
  assert.match(svg, /at list prices of 2026-09-25/);
  assert.match(shareText(r), /of at least \$0\.\d\d API-equivalent spend/);
  const none = await editedClaude((t) => t.replace(/"model":"claude-sonnet-5"/g, '"model":"claude-zeta-1"'), new Map());
  assert.match(shareText(none), /used at least \$0\.\d\d of API-equivalent tokens/);

  const priced = await editedClaude((t) => t);
  assert.doesNotMatch(renderShort(priced, OPTS), /unpriced/);
  assert.doesNotMatch(cardSvg(priced), /unpriced/);
  assert.doesNotMatch(shareText(priced), /at least/);
});

test("hypothetical Codex savings are left out of the short view, card and post, and named in the short view", () => {
  const r = result({
    savers: [
      saver("rtk", "rtk", 9.87),
      saver("token-saver", "token-saver", 5.43, { codexCost: 5.43, codexHypothetical: true }),
      saver("caveman-engine", "caveman (proxy engine)", 3.21, { codexCost: 1.21, codexHypothetical: true }),
    ],
  });
  const short = renderShort(r, OPTS);
  assert.match(short, /caveman engine\s+\$2\.00\s+0\.6%\s+exact/, "Codex part left out");
  assert.match(short, /token-saver\s+\$0\.00\s+0\.0%\s+exact/);
  assert.match(short, /The Codex part is left out above \(caveman engine about \$1\.21, token-saver about \$5\.43\): it is hypothetical, since Codex hooks cannot rewrite tool input\./);
  const svg = cardSvg(r);
  assert.doesNotMatch(svg, /token-saver/, "a saver with only a hypothetical Codex part is not on the card");
  assert.match(svg, /\$2\.00 · 0\.6%/);
  const post = shareText(r);
  assert.doesNotMatch(post, /token-saver/);
  assert.match(post, /caveman engine −0\.6% \(\$2\.00\)/);
  assert.match(post, /rtk −3\.2% \(\$9\.87\)/);
  // The full report keeps both parts, labelled.
  const full = renderTerminal(r, OPTS);
  assert.match(full, /token-saver\s+replayed[^\n]*\$5\.43/);
  assert.match(full, /the Codex part of these numbers is hypothetical: token-saver \$5\.43 of \$5\.43, caveman \(proxy engine\) \$1\.21 of \$3\.21\./);
});

test("a Codex part that is a net cost is never shown as a hypothetical saving", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-e1-"));
  try {
    const r = await runAudit(fixtureOptions(), undefined, 1, { ids: ["caveman-skill"], tools: new Map(), cacheFile: join(dir, "c.json") });
    const skill = r.savers.find((s) => s.id === "caveman-skill")!;
    assert.ok(skill.codexCost <= -0.005, "the skill's SKILL.md overhead outweighs its output cut on Codex");
    const full = renderTerminal(r, OPTS);
    assert.match(full, /caveman \(skill\) -\$0\.01 of -\$0\.03\./);
    assert.doesNotMatch(full, /caveman \(skill\) \$0\.01/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
