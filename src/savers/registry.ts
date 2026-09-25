// The launch set of savers (STATUS.md "Savers in scope"; mechanisms in tech-notes §8.5).
import type { OutputView, SaverInfo } from "./types.ts";

export interface SaverAdapter extends SaverInfo {
  /** Can the saver act on this tool output at all? (coverage) */
  appliesTo(o: OutputView): boolean;
  /** Replayed savers: input and argument for the external binary, or undefined to skip. */
  replayInput?(o: OutputView): { input: string; arg?: string } | undefined;
  /** Upper-bound savers: o200k tokens removed from this output (the ceiling). */
  ceiling?(o: OutputView): number;
}

// --- rtk ------------------------------------------------------------------
// `rtk pipe --filter <name>` filters recorded text offline. Only filters whose
// input format matches plain command output are used: live rtk rewrites
// `git status` / `git log` to formats its filters expect (tech-notes §8.5).
const RTK_FILTERS: Array<[RegExp, string]> = [
  [/^(python3? -m )?pytest\b/, "pytest"],
  [/^cargo (test|nextest)\b/, "cargo-test"],
  [/^cargo (build|check|clippy)\b/, "cargo"],
  [/^go test\b/, "go-test"],
  [/^go (build|vet)\b/, "go-build"],
  [/^ctest\b/, "ctest"],
  [/^(npx |pnpm (exec )?|yarn |bunx )?tsc\b/, "tsc"],
  [/^(npx |pnpm (exec )?|yarn |bunx )?vitest\b/, "vitest"],
  [/^(grep|rg|egrep)\b/, "grep"],
  [/^(find|fd)\b/, "find"],
  [/^git (diff|show)\b/, "git-diff"],
  [/^(python3? -m )?mypy\b/, "mypy"],
  [/^ruff check\b|^ruff\b(?! format)/, "ruff-check"],
  [/^ruff format\b/, "ruff-format"],
  [/^sqlfluff lint\b/, "sqlfluff-lint"],
  [/^(npx )?prettier\b/, "prettier"],
  [/^(vendor\/bin\/)?phpunit\b/, "phpunit"],
  [/^(vendor\/bin\/)?(pest|paratest)\b/, "pest"],
  [/^(vendor\/bin\/)?phpstan\b/, "phpstan"],
  [/^(vendor\/bin\/)?pint\b/, "pint"],
  [/^(vendor\/bin\/)?ecs\b/, "ecs"],
];

/** The rtk pipe filter for a shell command, looking at its last real segment. */
export function rtkFilter(command: string): string | undefined {
  const segments = command.split(/&&|;|\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    let seg = segments[i]!.split("|")[0]!.trim();
    seg = seg.replace(/^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "").replace(/^(sudo|time|env|timeout \S+)\s+/, "");
    if (/^cd\b|^echo\b|^export\b|^source\b/.test(seg)) continue;
    for (const [re, f] of RTK_FILTERS) if (re.test(seg)) return f;
    return undefined;
  }
  return undefined;
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
export const CONTEXT_MODE_BYTES = 5000; // INTENT_SEARCH_THRESHOLD, src/server.ts (tech-notes §8.5)

export const SAVERS: SaverAdapter[] = [
  {
    id: "rtk",
    name: "rtk",
    repo: "rtk-ai/rtk",
    version: "0.50.0",
    licence: "Apache-2.0",
    method: "replayed",
    covers: "shell output of commands rtk has a pipe filter for (tests, builds, grep/find, git diff, linters)",
    codexHypothetical: false,
    appliesTo: (o) => o.category === SHELL && !!o.command && !!rtkFilter(o.command),
    replayInput: (o) => {
      const arg = rtkFilter(o.command ?? "");
      if (!arg) return undefined;
      // rtk runs before Claude Code sees the output, so it filters the full raw output.
      const input = o.raw ?? (o.source === "codex" ? splitCodexHeader(o.text).body : o.text);
      return { input, arg };
    },
  },
  {
    id: "caveman-engine",
    name: "caveman (proxy engine)",
    repo: "JuliusBrussee/caveman",
    version: "2.7.0 (engine bin-v1.1.7)",
    licence: "BSL-1.1 (called as your installed binary, never bundled)",
    method: "replayed",
    covers: "every tool output in the request (the proxy compresses what is sent)",
    codexHypothetical: true,
    appliesTo: (o) => o.text.length > 0,
    replayInput: (o) => ({ input: o.text }),
  },
  {
    id: "headroom",
    name: "headroom",
    repo: "headroomlabs-ai/headroom",
    version: "0.38.0",
    licence: "Apache-2.0",
    method: "replayed",
    covers: "tool outputs its router compresses (by default it leaves Read, Grep, Glob, Edit, Write and web tools alone)",
    assumption: "each output replayed as the newest message; headroom also compresses older Read/Grep/Glob/Edit/Write outputs as they age, which is not replayed, so this is a lower estimate",
    codexHypothetical: false,
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
  {
    id: "codegraph",
    name: "codegraph",
    repo: "colbymchenry/codegraph",
    version: "1.6.0",
    licence: "MIT",
    method: "upper-bound",
    covers: "exploration output: Read, Grep, Glob and shell search/listing/file reading",
    assumption: "ceiling: every exploration output disappears and nothing replaces it (codegraph's own README reports ~80% more residual context)",
    codexHypothetical: true,
    appliesTo: (o) => o.category === "File reads" || o.category === "Search" || (o.category === SHELL && ["search", "listing & find", "file reading"].includes(o.family)),
    ceiling: (o) => o.tokens,
  },
  {
    id: "context-mode",
    name: "context-mode",
    repo: "mksglu/context-mode",
    version: "1.0.169",
    licence: "Elastic-2.0 (not bundled)",
    method: "upper-bound",
    covers: `tool outputs over ${CONTEXT_MODE_BYTES.toLocaleString("en-US")} bytes`,
    assumption: `ceiling: every tool output over ${CONTEXT_MODE_BYTES.toLocaleString("en-US")} bytes disappears (in reality only when the agent passes an intent, or over 102,400 bytes)`,
    codexHypothetical: true,
    appliesTo: (o) => Buffer.byteLength(o.text, "utf8") > CONTEXT_MODE_BYTES,
    ceiling: (o) => o.tokens,
  },
];

export function saverIndex(ids: string[] | undefined): SaverAdapter[] {
  if (!ids) return SAVERS;
  const known = new Map(SAVERS.map((s) => [s.id, s]));
  const out: SaverAdapter[] = [];
  for (const id of ids) {
    const s = known.get(id) ?? SAVERS.find((x) => x.id.startsWith(id));
    if (!s) throw new Error(`--savers: unknown saver "${id}" (known: ${SAVERS.map((x) => x.id).join(", ")})`);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
