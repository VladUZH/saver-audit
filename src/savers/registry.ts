// All savers: the built-in manifests (src/savers/builtin/*.json), the user's own
// manifests (~/.saver-audit/savers/*.json), and two savers that need code: headroom
// (a Python sidecar) and the caveman skill (modeled from a cited measurement).
// Mechanisms: tech-notes §8.5.
import type { OutputView, SaverInfo } from "./types.ts";
import { findRoute, loadManifests, type SaverManifest } from "./manifest.ts";
import rtk from "./builtin/rtk.json" with { type: "json" };
import cavemanEngine from "./builtin/caveman-engine.json" with { type: "json" };
import codegraph from "./builtin/codegraph.json" with { type: "json" };
import contextMode from "./builtin/context-mode.json" with { type: "json" };

export interface SaverAdapter extends SaverInfo {
  /** Can the saver act on this tool output at all? (coverage) */
  appliesTo(o: OutputView): boolean;
  /**
   * Replayed savers: the input for the saver's program, the route name (part of the
   * replay cache key) and the program's arguments; undefined to skip.
   */
  replayInput?(o: OutputView): { input: string; arg?: string; args?: string[] } | undefined;
  /** "tool": acts before the agent sees the output, on the full raw output. "request": on what was sent. */
  stage?: "tool" | "request";
  /** Manifest-based savers: how to find and run the program. */
  manifest?: SaverManifest;
  /** Upper-bound savers: o200k tokens removed from this output (the ceiling). */
  ceiling?(o: OutputView): number;
  /**
   * Replayed savers: outputs below this many o200k tokens are counted as unchanged
   * without replaying them (tech-notes §8.9: they carry ~2% of caveman's savings and
   * none of headroom's).
   */
  minTokens?: number;
}

const SHELL = "Shell";

// headroom 0.38.0 config.py DEFAULT_EXCLUDE_TOOLS: never compressed while recent.
const HEADROOM_EXCLUDED = new Set(["Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch", "headroom_retrieve", "view", "read_file", "Skill", "read", "glob", "grep", "skill", "write", "edit", "web_search", "web_fetch"]);

/** Codex shell outputs start with a header (Exit code / Wall time / Output:). */
export function splitCodexHeader(text: string): { header: string; body: string } {
  const i = text.indexOf("Output:\n");
  if (i >= 0 && i < 400) return { header: text.slice(0, i + 8), body: text.slice(i + 8) };
  return { header: "", body: text };
}

export const CAVEMAN_SKILL_TOKENS = 1650; // o200k count of skills/caveman/SKILL.md at v2.7.0 (880114a420)
export const CAVEMAN_SKILL_OUTPUT_CUT = 0.085; // JetBrains, 2026-07: −8.5% output tokens (tech-notes §3)

/** The input a saver sees: the full raw output for tool-stage savers, else what was sent. */
function inputFor(stage: "tool" | "request" | undefined, o: OutputView): string {
  if (stage === "tool") return o.raw ?? (o.source === "codex" ? splitCodexHeader(o.text).body : o.text);
  return o.text;
}

/** An adapter from a manifest (built-in or community). */
export function manifestAdapter(m: SaverManifest): SaverAdapter {
  const base = {
    id: m.id,
    name: m.name,
    repo: m.repo,
    version: m.version,
    licence: m.licence,
    method: m.method,
    covers: m.covers,
    assumption: m.assumption,
    codexHypothetical: m.codexHypothetical ?? true,
    minTokens: m.minTokens,
    stage: m.stage ?? "request",
    manifest: m,
    appliesTo: (o: OutputView) => o.text.length > 0 && !!findRoute(m, o),
  };
  if (m.method === "upper-bound") return { ...base, ceiling: (o) => o.tokens };
  return {
    ...base,
    replayInput: (o) => {
      const route = findRoute(m, o);
      if (!route) return undefined;
      return { input: inputFor(m.stage, o), arg: route.name, args: route.args ?? [] };
    },
  };
}

const BUILTIN: SaverManifest[] = [rtk, cavemanEngine, codegraph, contextMode] as SaverManifest[];

const CODE_SAVERS: SaverAdapter[] = [
  {
    id: "headroom",
    name: "headroom",
    repo: "headroomlabs-ai/headroom",
    version: "0.38.0",
    licence: "Apache-2.0",
    method: "replayed",
    covers: "tool outputs its router compresses (by default it leaves Read, Grep, Glob, Edit, Write and web tools alone)",
    assumption: "an estimate from a sample of 300 outputs (the largest half always included); on the author's logs that was within 3% over a month but 20–37% off on single weeks, so use --full-replay for exact numbers. Each output is replayed as the newest message; headroom also compresses older Read/Grep/Glob/Edit/Write outputs as they age, which is not replayed",
    codexHypothetical: false,
    minTokens: 200,
    appliesTo: (o) => o.text.length > 0 && !HEADROOM_EXCLUDED.has(o.tool),
    replayInput: (o) => ({ input: o.text }),
  },
  {
    id: "caveman-skill",
    name: "caveman (skill)",
    repo: "JuliusBrussee/caveman",
    version: "2.7.0",
    licence: "MIT",
    method: "modeled",
    covers: "assistant output style; adds its SKILL.md to every prompt",
    assumption: `output −${(CAVEMAN_SKILL_OUTPUT_CUT * 100).toFixed(1)}% (JetBrains' measurement; caveman publishes none), plus ${CAVEMAN_SKILL_TOKENS} o200k tokens of SKILL.md in every prompt`,
    codexHypothetical: true,
    appliesTo: () => false,
  },
];

// Order in the report: the launch set first, then community manifests.
const ORDER = ["rtk", "caveman-engine", "headroom", "caveman-skill", "codegraph", "context-mode"];

function build(manifests: SaverManifest[]): SaverAdapter[] {
  const all = [...manifests.map(manifestAdapter), ...CODE_SAVERS];
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return all.sort((a, b) => rank(a.id) - rank(b.id));
}

/** The built-in savers (no user manifests): stable for tests and the docs. */
export const SAVERS: SaverAdapter[] = build(BUILTIN);

let loaded: { savers: SaverAdapter[]; problems: string[] } | undefined;

/** Built-in savers plus the user's own manifests from ~/.saver-audit/savers. */
export function allSavers(): { savers: SaverAdapter[]; problems: string[] } {
  if (!loaded) {
    const { manifests, problems } = loadManifests(BUILTIN);
    loaded = { savers: build(manifests), problems };
  }
  return loaded;
}

/** The rtk pipe filter for a shell command (from rtk's manifest routes). */
export function rtkFilter(command: string): string | undefined {
  return findRoute(rtk as SaverManifest, { source: "claude-code", tool: "Bash", category: "Shell", family: "", command, text: "x", tokens: 1 })?.name;
}

export function saverIndex(ids: string[] | undefined): SaverAdapter[] {
  const all = allSavers().savers;
  if (!ids) return all;
  const known = new Map(all.map((s) => [s.id, s]));
  const out: SaverAdapter[] = [];
  for (const id of ids) {
    const s = known.get(id) ?? all.find((x) => x.id.startsWith(id));
    if (!s) throw new Error(`--savers: unknown saver "${id}" (known: ${all.map((x) => x.id).join(", ")})`);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
