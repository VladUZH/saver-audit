import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditResult } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { cardSvg } from "../src/report/card.ts";
import { renderJson } from "../src/report/json.ts";
import { shareText } from "../src/report/share.ts";
import { confidence, fmtRange, isIndicative, quickRange, renderShort, renderTerminal, tooLittleData } from "../src/report/terminal.ts";
import type { ReplayTool } from "../src/savers/replay.ts";
import { FAKE_TOOLS, fixtureOptions } from "./helpers.ts";

const BIN = fileURLToPath(new URL("./fixtures/bin/", import.meta.url));
const OPTS = { showProjects: false, verbose: false, color: false };

async function audit(tools: Map<string, ReplayTool>, full: boolean | string[] = true): Promise<AuditResult> {
  const dir = mkdtempSync(join(tmpdir(), "sa-report-"));
  try {
    return await runAudit(fixtureOptions(), undefined, 1, { ids: [...tools.keys()], tools, cacheFile: join(dir, "c.json"), full });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("headroom without its model: 'not measured' with the reason, never '$0.00 exact' or a posted number", async () => {
  const r = await audit(new Map([["rtk", FAKE_TOOLS.get("rtk")!], ["headroom", { saver: "headroom", command: join(BIN, "fake-headroom"), version: "0.38.0", env: { FAKE_READY: "0" } }]]));
  const h = r.savers.find((s) => s.id === "headroom")!;
  assert.equal(confidence(h), "not measured");
  const short = renderShort(r, OPTS);
  assert.match(short, /headroom\s+—\s+not measured: compression model not cached/);
  assert.doesNotMatch(short, /headroom\s+\$/);
  assert.match(renderTerminal(r, OPTS), /headroom\s+replayed[^\n]*—\s+not measured: compression model not cached/);
  assert.doesNotMatch(cardSvg(r), /headroom/);
  assert.doesNotMatch(shareText(r), /headroom/);
  const json = JSON.parse(renderJson(r, { showProjects: false, version: "test" }));
  assert.equal(json.savers.find((s: { id: string }) => s.id === "headroom").replay.reason, "compression model not cached");
});

test("a saver whose every replay failed shows why, not a measured 0%", async () => {
  const r = await audit(new Map([["caveman-engine", { saver: "caveman-engine", command: join(BIN, "fake-saver"), env: { FAKE_FAIL: "1" } }]]));
  const c = r.savers.find((s) => s.id === "caveman-engine")!;
  assert.equal(tooLittleData(c), true);
  assert.match(renderShort(r, OPTS), /caveman engine\s+—\s+not measured: every replay failed/);
  assert.doesNotMatch(renderShort(r, OPTS), /exact$/m);
});

test("some failed replays: the number is indicative everywhere, and the full report gives the count", async () => {
  const r = await audit(new Map([["rtk", FAKE_TOOLS.get("rtk")!]]));
  const rtk = r.savers.find((s) => s.id === "rtk")!;
  assert.equal(confidence(rtk), "exact");
  rtk.replay = { total: 10, pending: 0, ran: 10, extrapolated: 0, failed: 2 };
  assert.equal(isIndicative(rtk), true);
  assert.equal(confidence(rtk), "indicative");
  assert.match(renderTerminal(r, OPTS), /rtk: 2 replays failed and count as unchanged/);
  const short = renderShort(r, OPTS);
  assert.match(short, /rtk\s+\$[\d.]+\s+[\d.]+%\s+indicative/);
  assert.match(short, /Some replays failed and count as unchanged/);
  assert.match(shareText(r), /rtk ≈/);
  assert.match(cardSvg(r), /replayed · indicative/);
});

test("a saver with no number gets no 'indicative … replayed … extrapolated' note", async () => {
  const r = await audit(new Map([["headroom", FAKE_TOOLS.get("headroom")!]]), false);
  const c = r.savers.find((s) => s.id === "headroom")!;
  assert.equal(tooLittleData(c), true, "cache-only in quick mode, nothing cached");
  const full = renderTerminal(r, OPTS);
  assert.match(full, /headroom\s+replayed[^\n]*exact run needed: --exact/);
  assert.doesNotMatch(full, /headroom: indicative/);
  assert.equal(quickRange(c), undefined);
});

test("a quick estimate states its own likely range: per saver in the report, compact in the short view, the se in JSON, ≈ only on the card and post", async () => {
  const r = await audit(new Map([["rtk", FAKE_TOOLS.get("rtk")!]]));
  const rtk = r.savers.find((s) => s.id === "rtk")!;
  rtk.replay = { total: 3000, pending: 2730, ran: 270, extrapolated: 2600, failed: 0, measured: 390, se: 0.6, changed: 40, estimate: 10, unit: "usd" };
  rtk.replayTotal = 3000;
  assert.equal(quickRange(rtk), 0.12);
  const full = renderTerminal(r, OPTS);
  assert.match(full, /rtk: indicative: 390 outputs measured, 2,600 estimated from them; likely within ±12% \(2 s\.e\., in dollars\); --exact for exact numbers\./);
  assert.match(renderTerminal(r, { ...OPTS, menu: true }), /; press \[e\] for exact numbers\./);
  const short = renderShort(r, OPTS);
  assert.match(short, /"indicative" = from a quick sample, likely within rtk ±12%\./);
  assert.doesNotMatch(short + full, /off by half/);
  const json = JSON.parse(renderJson(r, { showProjects: false, version: "test" })).savers.find((s: { id: string }) => s.id === "rtk").replay;
  assert.deepEqual([json.se, json.estimate, json.unit, json.measured], [0.6, 10, "usd", 390]);
  assert.match(shareText(r), /rtk ≈/);
  assert.doesNotMatch(shareText(r) + cardSvg(r), /±/);
  // Nothing priced: the range is in tokens, and dollars are said to be off by more.
  rtk.replay = { ...rtk.replay, unit: "tokens" };
  assert.match(renderTerminal(r, OPTS), /likely within ±12% \(2 s\.e\., in tokens; dollars weight outputs differently and can be off by more\)/);
  assert.match(renderShort(r, OPTS), /likely within rtk ±12% \(in tokens\)\./);
  assert.equal(fmtRange(0.004), "±1%");
  assert.equal(fmtRange(Infinity), "±>999%");
});

test("the short view's range is for the number on the row: without a hypothetical Codex part", async () => {
  const r = await audit(new Map([["rtk", FAKE_TOOLS.get("rtk")!]]));
  const x = r.savers.find((s) => s.id === "rtk")!;
  Object.assign(x, { codexHypothetical: true, cost: 10, codexCost: 4 });
  x.replay = { total: 3000, pending: 2730, ran: 270, extrapolated: 2600, failed: 0, measured: 390, se: 0.6, changed: 40, estimate: 10, unit: "usd", outsideCodex: { estimate: 6, se: 0.9 } };
  x.replayTotal = 3000;
  assert.match(renderShort(r, OPTS), /rtk\s+\$6\.00/, "the row shows the part outside Codex");
  assert.match(renderShort(r, OPTS), /likely within rtk ±30%\./, "2 × 0.9 / 6, not 2 × 0.6 / 10");
  assert.match(renderTerminal(r, OPTS), /likely within ±12% \(2 s\.e\., in dollars\)/, "the full report shows the total, with its range");
});

test("a sample with no spread (no sampled output changed) gives no range, never ±1%", async () => {
  const r = await audit(new Map([["rtk", FAKE_TOOLS.get("rtk")!]]));
  const x = r.savers.find((s) => s.id === "rtk")!;
  x.replay = { total: 3000, pending: 2730, ran: 270, extrapolated: 2600, failed: 0, measured: 390, se: 0, changed: 0, estimate: 10, unit: "usd" };
  x.replayTotal = 3000;
  assert.equal(quickRange(x), undefined);
  const both = renderShort(r, OPTS) + renderTerminal(r, OPTS);
  assert.doesNotMatch(both, /±/);
  assert.match(renderTerminal(r, OPTS), /no range can be given: none of the sampled outputs changed/);
  assert.match(renderShort(r, OPTS), /rtk no range \(no sampled output changed\)/);
});

test("an estimate from the measured outputs' ratio says how much is estimated, with no ±", async () => {
  const r = await audit(new Map([["rtk", FAKE_TOOLS.get("rtk")!]]));
  const h = r.savers.find((s) => s.id === "rtk")!;
  h.replay = { total: 3000, pending: 40, ran: 0, extrapolated: 40, failed: 0, measured: 2950, fromMeasured: 0.12, estimate: 10, unit: "usd" };
  h.replayTotal = 3000;
  assert.equal(quickRange(h), undefined);
  assert.equal(confidence(h), "indicative");
  assert.match(renderTerminal(r, OPTS), /rtk: indicative: 40 outputs not measured, 12% of it by dollar value, get the ratio of the 2,950 measured ones, so any error is confined to that share; --exact for exact numbers\./);
  assert.match(renderShort(r, OPTS), /"indicative" = from a quick sample; rtk 12% from measured results\./);
  assert.doesNotMatch(renderShort(r, OPTS) + renderTerminal(r, OPTS), /±/);
});
