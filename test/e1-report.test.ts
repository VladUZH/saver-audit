import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult } from "../src/audit.ts";
import { runAudit } from "../src/pool.ts";
import { cardSvg } from "../src/report/card.ts";
import { shareText } from "../src/report/share.ts";
import { renderShort } from "../src/report/terminal.ts";
import { CLAUDE_ROOT, FAKE_TOOLS, fixtureOptions } from "./helpers.ts";

const OPTS = { showProjects: false, verbose: false, color: false };

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
