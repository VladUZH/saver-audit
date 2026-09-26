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
import { confidence, isIndicative, renderShort, renderTerminal, replayedShare, tooLittleData } from "../src/report/terminal.ts";
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
  const r = await audit(new Map([["caveman-engine", FAKE_TOOLS.get("caveman-engine")!]]), false);
  const c = r.savers.find((s) => s.id === "caveman-engine")!;
  assert.equal(tooLittleData(c), true, "cache-only in quick mode, nothing cached");
  const full = renderTerminal(r, OPTS);
  assert.match(full, /caveman \(proxy engine\)\s+replayed[^\n]*exact run needed: --exact/);
  assert.doesNotMatch(full, /caveman \(proxy engine\): indicative/);
  assert.equal(replayedShare({ ...c, replay: { total: 3000, pending: 3000, ran: 0, extrapolated: 3000, failed: 0 }, replayTotal: 3000 }), "0%", "none replayed is 0%, not 0.1%");
  assert.equal(replayedShare({ ...c, replay: { total: 3000, pending: 2999, ran: 1, extrapolated: 2999, failed: 0 }, replayTotal: 3000 }), "0.1%");
});
