import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/pool.ts";
import { intentUrl, REPO_URL, shareText, xLength } from "../src/report/share.ts";
import { loggedDays, renderShort } from "../src/report/terminal.ts";
import { SAVERS } from "../src/savers/registry.ts";
import { FAKE_TOOLS, fixtureOptions, SECRET } from "./helpers.ts";

async function fixtureResult() {
  const dir = mkdtempSync(join(tmpdir(), "sa-share-"));
  try {
    return await runAudit(fixtureOptions(), undefined, 1, { ids: SAVERS.map((s) => s.id), tools: FAKE_TOOLS, cacheFile: join(dir, "c.json"), full: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the pre-filled post holds numbers only and fits a post", async () => {
  const r = await fixtureResult();
  const text = shareText(r);
  assert.doesNotMatch(text, SECRET);
  for (const p of r.projects) assert.equal(text.includes(p), false);
  // The fixture sessions span 2026-09-20..22 in a 29-day window.
  assert.match(text, new RegExp(`^I replayed ${loggedDays(r)} days of my Claude Code \\+ Codex sessions through popular token savers:`));
  assert.ok(loggedDays(r) <= 4);
  assert.match(text, /\nheadroom at least −[\d.]+% \(\$0\.\d\d\)/, "measured savers lead, with % and $");
  assert.match(text, /of \$0\.04 API-equivalent spend\./);
  assert.match(text, /npx saver-audit$/);
  // X counts every link as 23 characters, and "−" or "≈" as 2.
  assert.ok(xLength(text) + 1 + 23 <= 280, `${xLength(text)} weighted characters`);
});

test("the X intent link carries the text and the repo", () => {
  const url = new URL(intentUrl("a b & c\n$1"));
  assert.equal(url.origin + url.pathname, "https://x.com/intent/tweet");
  assert.equal(url.searchParams.get("text"), "a b & c\n$1");
  assert.equal(url.searchParams.get("url"), REPO_URL);
});

test("the short view: headline, where it went, savers, card; nothing private", async () => {
  const r = await fixtureResult();
  const out = renderShort(r, { showProjects: false, verbose: false, color: false, cardPath: "saver-audit.png" });
  assert.doesNotMatch(out, SECRET);
  assert.match(out, /\$0\.04 API-equivalent at list prices/);
  assert.match(out, /Where it went/);
  assert.match(out, /What token savers would cut/);
  assert.match(out, /Share card: saver-audit\.png/);
  assert.ok(out.split("\n").length < 30, "fits one screen");
});

test("without installed savers the post uses modeled and best-case numbers, labelled", async () => {
  const r = await runAudit(fixtureOptions(), undefined, 1, { ids: SAVERS.map((s) => s.id), tools: new Map() });
  const text = shareText(r);
  assert.match(text, /^My AI coding agents \(Claude Code \+ Codex\) used \$0\.04/);
  assert.match(text, /Best case \(changes how the agent works\): at most −[\d.]+% \(context-mode\)/);
  assert.doesNotMatch(text, /caveman skill/, "modeled numbers are not posted");
  assert.doesNotMatch(text, /replayed/);
  assert.ok(xLength(text) + 1 + 23 <= 280);
});
