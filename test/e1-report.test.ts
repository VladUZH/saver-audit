import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult, SaverRow } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { cardSvg } from "../src/report/card.ts";
import { shareText, xLength } from "../src/report/share.ts";
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

test("X's weighted length: Latin 1, '−' '≈' '≤' and CJK 2, a link 23", () => {
  assert.equal(xLength("abc $1.00"), 9);
  assert.equal(xLength("é—"), 2, "U+00E9 and U+2014 weigh 1");
  assert.equal(xLength("−≈≤…"), 8);
  assert.equal(xLength("日本"), 4);
  assert.equal(xLength("see https://github.com/VladUZH/saver-audit now"), 4 + 23 + 4);
  assert.equal(xLength("e\u0301"), 1, "NFC first");
});

test("the post fits X's weighted limit with the link, with many savers and '≈' marks", () => {
  const indicative = { replay: { total: 100, pending: 0, ran: 50, extrapolated: 50, failed: 0 } };
  const ceiling = saver("context-mode", "context-mode", 45.6, { method: "upper-bound" });
  const four = result({ savers: [saver("rtk", "rtk", 9.87), saver("lean-ctx", "lean-ctx", 7.65), saver("token-saver", "token-saver", 5.43), saver("caveman-engine", "caveman (proxy engine)", 3.21), ceiling] });
  const big = { billing: { ...result().billing, total: amt(3e9, 1234.5) } };
  const five = result({ ...big, savers: [saver("rtk", "rtk", 98.7, indicative), saver("lean-ctx", "lean-ctx", 76.5, indicative), saver("token-saver", "token-saver", 54.3, indicative), saver("caveman-engine", "caveman (proxy engine)", 32.1, indicative), saver("headroom", "headroom", 21.2, indicative), ceiling] });
  for (const r of [four, five]) {
    const post = shareText(r);
    assert.ok(xLength(post) + 1 + 23 <= 280, `${xLength(post)} weighted characters:\n${post}`);
    assert.match(post, /rtk ≈?−/);
  }
});

test("the card and the post state the days the logs cover, not the requested window", () => {
  const long = result({ period: { since: "2026-01-01T12:00:00.000Z", until: "2026-09-30T12:00:00.000Z" }, covered: { first: "2026-09-20T12:00:00.000Z", last: "2026-09-22T12:00:00.000Z" }, savers: [saver("rtk", "rtk", 9.87)] });
  assert.match(shareText(long), /^I replayed 3 days of my /);
  assert.match(cardSvg(long), /2026-01-01 → 2026-09-30 · logs cover 3 days</);
  assert.match(shareText({ ...long, savers: [] }), / in 3 days\./);
  const one = { ...long, covered: { first: "2026-09-20T11:00:00.000Z", last: "2026-09-20T13:00:00.000Z" } };
  assert.match(shareText(one), /^I replayed 1 day of my /);
  assert.match(cardSvg(one), /logs cover 1 day</);
  // Logs over the whole window: the window's days.
  const full = result({ covered: { first: "2026-08-27T13:00:00.000Z", last: "2026-09-26T11:00:00.000Z" }, savers: [saver("rtk", "rtk", 9.87)] });
  assert.match(shareText(full), /^I replayed 30 days of my /);
  assert.match(cardSvg(full), /2026-08-27 → 2026-09-26 · 30 days</);
});
