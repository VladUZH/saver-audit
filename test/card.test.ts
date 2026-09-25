import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/pool.ts";
import { cardSvg, writeCard } from "../src/report/card.ts";
import { normalizeCardArg } from "../src/args.ts";
import { SAVERS } from "../src/savers/registry.ts";
import { FAKE_TOOLS, fixtureOptions, SECRET } from "./helpers.ts";

test("the share card holds numbers, model names, dates and fixed labels only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-card-"));
  try {
    const r = await runAudit(fixtureOptions(), undefined, 1, { ids: SAVERS.map((s) => s.id), tools: FAKE_TOOLS, cacheFile: join(dir, "c.json"), full: true });
    const svg = cardSvg(r);
    assert.doesNotMatch(svg, SECRET);
    for (const p of r.projects) assert.equal(svg.includes(p), false, "no project names, even though the result has them");
    assert.match(svg, /\$0\.04/);
    assert.match(svg, /What token savers would cut/);
    const png = join(dir, "card.png");
    await writeCard(r, png);
    const bytes = readFileSync(png);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 675);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--card takes an optional path", () => {
  assert.deepEqual(normalizeCardArg(["--card"]), ["--card=saver-audit.png"]);
  assert.deepEqual(normalizeCardArg(["--card", "--json"]), ["--card=saver-audit.png", "--json"]);
  assert.deepEqual(normalizeCardArg(["--card", "me.png"]), ["--card", "me.png"]);
});
