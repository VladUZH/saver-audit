import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditOptions } from "../src/audit.ts";
import { loadPrices } from "../src/prices/load.ts";
import type { SourceEvent } from "../src/sources/types.ts";
import type { ReplayTool } from "../src/savers/replay.ts";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const CLAUDE_ROOT = join(FIXTURES, "claude", "projects");
export const CODEX_HOME = join(FIXTURES, "codex");

export function fixtureOptions(over: Partial<AuditOptions> = {}): AuditOptions {
  return {
    sinceMs: Date.parse("2026-09-01T00:00:00Z"),
    untilMs: Date.parse("2026-09-30T00:00:00Z"),
    sources: ["claude-code", "codex"],
    claudeRoots: [CLAUDE_ROOT],
    codexHome: CODEX_HOME,
    prices: loadPrices(),
    ...over,
  };
}

export async function collect(gen: AsyncGenerator<SourceEvent>): Promise<SourceEvent[]> {
  const out: SourceEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** Every string in the fixtures that must never reach a default report. */
export const SECRET = /SECRET|\/home\/dev|pytest|git status|npm test/;

/** Deterministic fake saver binaries (test/fixtures/bin), so tests never need the real tools. */
const BIN = join(FIXTURES, "bin");
export const FAKE_TOOLS = new Map<string, ReplayTool>([
  ["rtk", { saver: "rtk", command: join(BIN, "rtk"), version: "0.50.0" }],
  ["caveman-engine", { saver: "caveman-engine", command: join(BIN, "caveman-engine") }],
  ["headroom", { saver: "headroom", command: join(BIN, "headroom-python"), version: "0.38.0" }],
]);
