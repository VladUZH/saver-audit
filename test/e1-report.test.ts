import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processFile, summarize, type AuditResult, type SaverRow } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { cardSvg, fitList } from "../src/report/card.ts";
import { shareText, xLength } from "../src/report/share.ts";
import { renderShort, renderTerminal, unpricedCalls } from "../src/report/terminal.ts";
import { CLAUDE_ROOT, CODEX_HOME, FAKE_TOOLS, fixtureOptions } from "./helpers.ts";

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
    sessions: { main: 40, subagent: 5, bySource: { "claude-code": 25, codex: 15 }, sources: ["claude-code", "codex"] },
    calls: 4000,
    models: [{ model: "claude-opus-5-5", pricedAs: "claude-opus-5-5", calls: 4000, tokens: 3e8, cost: 312.4 }],
    billing: { input: amt(1e6, 5), cacheWrite: amt(1e7, 50), cacheRead: amt(2.8e8, 140), output: amt(9e6, 117.4), webSearch: { requests: 0, cost: 0, unpriced: 0 }, total: amt(3e8, 312.4) },
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

test("Codex web searches left out of the total are named next to it in the short view, on the card and in the post", async () => {
  const r = summarize(fixtureOptions({ sources: ["codex"] }), [await processFile(join(CODEX_HOME, "cases", "rollout-web-search.jsonl"), "codex", 0)]);
  assert.deepEqual(r.billing.webSearch, { requests: 0, cost: 0, unpriced: 3 });
  assert.equal(unpricedCalls(r), 0, "every model is priced: the searches alone leave something out");
  assert.match(renderShort(r, OPTS), /API-equivalent at list prices[^\n]*\nExcludes the fees for 3 Codex web searches: the price list has no OpenAI per-search fee\./);
  assert.match(cardSvg(r), />excludes fees for 3 Codex web searches</);
  assert.match(shareText(r), /used at least \$0\.\d\d of API-equivalent tokens/);
  assert.match(shareText({ ...r, savers: [saver("rtk", "rtk", 0.01)] }), /of at least \$0\.\d\d API-equivalent spend/);
  // With calls on an unpriced model too, the card says both on its one line.
  const both = { ...r, models: [...r.models, { model: "gpt-zeta-1", calls: 2, tokens: 1000, cost: 0 }] };
  assert.match(cardSvg(both), />excludes 2 calls on unpriced models and fees for 3 Codex web searches</);
  const one = { ...r, billing: { ...r.billing, webSearch: { ...r.billing.webSearch, unpriced: 1 } } };
  assert.match(renderShort(one, OPTS), /Excludes the fees for 1 Codex web search:/);
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

test("a period with only a subagent's calls names its agent and counts subagent runs, not '0 sessions'", async () => {
  // In the fixture, only the Claude subagent made a call in these ten seconds.
  const r = await runAudit(fixtureOptions({ sinceMs: Date.parse("2026-09-20T10:00:20Z"), untilMs: Date.parse("2026-09-20T10:00:30Z") }), undefined, 1);
  assert.deepEqual(r.sessions, { main: 0, subagent: 1, bySource: {}, sources: ["claude-code"] });
  const short = renderShort(r, OPTS);
  assert.match(short, /^saver-audit · \S+ → \S+ · Claude Code\n1 subagent run · 1 API call\n/);
  assert.doesNotMatch(short, /0 sessions/);
  const svg = cardSvg(r);
  assert.match(svg, />1 API call · 1 subagent run</);
  assert.match(svg, />Claude Code</);
  assert.match(shareText(r), /^My AI coding agents \(Claude Code\) used /);
  assert.match(renderTerminal(r, OPTS), /^0 sessions \+ 1 subagent runs, /m);
});

test("the card's best-case line stays inside its panel with any number of ceilings", () => {
  const bound = (id: string, cost: number) => saver(id, id, cost, { method: "upper-bound" });
  const line = (r: AuditResult) => /best case, not measured:[^<]*/.exec(cardSvg(r))![0].replace(/&lt;/g, "<");
  const two = line(result({ savers: [bound("codegraph", 43.7), bound("context-mode", 53.1)] }));
  assert.equal(two, "best case, not measured: context-mode ≤ 17% · codegraph ≤ 14%");
  const four = line(result({ savers: [bound("codegraph", 43.7), bound("context-mode", 53.1), bound("smart-file-reader", 25), bound("mcp-slim", 12.5)] }));
  // The right panel's text area is 512 px: 65 characters of 13 px JetBrains Mono.
  assert.ok(four.length <= 65, four);
  assert.match(four, /^best case, not measured: context-mode ≤ 17% · \+3 more$/);
  assert.equal(fitList("head:", ["a-very-long-community-saver-name ≤ 12%", "b ≤ 1%"], 30), "head: a-very-long-c… · +1 more", "30 characters");
  assert.equal(fitList("head:", ["aa", "bb", "cc"], 40), "head: aa · bb · cc");
});

test("with no saver measured, the short view and card say why, and offer an install only when one is missing", () => {
  const bound = (id: string) => saver(id, id, 40, { method: "upper-bound" });
  const missing = saver("rtk", "rtk", 0, { status: "not installed" });
  const ceilingsOnly = result({ savers: [bound("codegraph"), bound("context-mode")] });
  assert.match(renderShort(ceilingsOnly, OPTS), /None measured: none of the selected savers is replayed \(--savers\)\./);
  assert.doesNotMatch(renderShort(ceilingsOnly, OPTS), /is installed/);
  assert.match(renderShort(result({ savers: [missing, bound("codegraph")] }), OPTS), /None measured yet: none of the replayed savers in this run is installed\./);

  const card = (savers: SaverRow[]) => cardSvg(result({ savers }));
  for (const svg of [card([]), card([bound("codegraph"), bound("context-mode")])]) {
    assert.match(svg, /No saver replayed in this run\./);
    assert.doesNotMatch(svg, /--install-savers/);
  }
  const pending = saver("caveman-engine", "caveman (proxy engine)", 0, { replay: { total: 50, pending: 50, ran: 0, extrapolated: 0, failed: 0, insufficient: true } });
  assert.match(card([pending, missing]), /exact numbers: npx saver-audit --exact/);
  assert.doesNotMatch(card([pending, missing]), /--install-savers/);
  assert.match(card([missing]), /npx saver-audit --install-savers/);
  assert.match(card([saver("token-saver", "token-saver", 5, { codexCost: 5, codexHypothetical: true })]), /Only hypothetical savings, on Codex\./);
  const failed = saver("caveman-engine", "caveman (proxy engine)", 0, { replay: { total: 50, pending: 0, ran: 50, extrapolated: 0, failed: 50, insufficient: true, failedOut: true, reason: "every replay failed" } });
  assert.match(card([failed]), /No saver measured: replays failed\./);
  assert.doesNotMatch(card([failed]), /npx saver-audit --/);
});

test("a quick sample too small, with a few failed replays, asks for an exact run everywhere; failures are not blamed", () => {
  // Two of the largest outputs failed, then the quick deadline passed before any smaller one was replayed.
  const quick = saver("token-saver", "token-saver", 0, { replay: { total: 200, pending: 116, ran: 84, extrapolated: 0, failed: 2, insufficient: true, reason: "too few outputs replayed in quick mode" } });
  const r = result({ savers: [quick] });
  const svg = cardSvg(r);
  assert.doesNotMatch(svg, /replays failed/);
  assert.match(svg, /No saver measured yet\./);
  assert.match(svg, /exact numbers: npx saver-audit --exact/);
  const short = renderShort(r, OPTS);
  assert.match(short, /token-saver\s+—\s+exact run needed: --exact/);
  assert.match(short, /For exact numbers \(once; cached\): npx saver-audit --exact/);
  const menu = renderShort(r, { ...OPTS, menu: true });
  assert.match(menu, /token-saver\s+—\s+exact run needed: press \[e\]/);
  assert.match(menu, /Press \[e\] for exact numbers/);
  assert.match(renderTerminal(r, OPTS), /token-saver[^\n]*—\s+exact run needed: --exact/);
  // When the failures are the cause, the row gives the reason instead.
  const failedOut = saver("token-saver", "token-saver", 0, { replay: { total: 200, pending: 0, ran: 200, extrapolated: 0, failed: 150, insufficient: true, failedOut: true, reason: "most replays failed" } });
  const bad = result({ savers: [failedOut] });
  assert.match(renderShort(bad, OPTS), /token-saver\s+—\s+not measured: most replays failed/);
  assert.doesNotMatch(renderShort(bad, OPTS), /--exact/);
  assert.match(cardSvg(bad), /No saver measured: replays failed\./);
});
