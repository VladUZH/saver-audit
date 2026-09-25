// Saver manifests: one JSON file describes a saver, so anyone can add one without
// writing code (CONTRIBUTING.md). Built-in manifests ship in src/savers/builtin/;
// your own go in ~/.saver-audit/savers/*.json.
//
// A replayed saver is a program that reads a tool output on stdin and writes what the
// agent would see instead on stdout: deterministic, offline, no network. A saver that
// changes how the agent behaves can only be an upper bound. Honesty is enforced here:
// there is no "modeled" manifest (a modeled saver needs a cited measurement, so it
// goes through code review as code).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toolsDir } from "./toolsdir.ts";
import type { OutputView } from "./types.ts";

export interface RouteMatch {
  /** Tool names, e.g. ["Bash", "exec_command"]. */
  tools?: string[];
  /** Report categories: Shell, File reads, File edits, Search, Web fetch, Web search, Subagents, MCP tools, Other tools. */
  categories?: string[];
  /** Shell families: tests, git, build & lint, search, file reading, listing & find, … */
  families?: string[];
  /** Regular expression tested against the shell command's last real segment. */
  command?: string;
  /** Tools to leave alone. */
  excludeTools?: string[];
  /** Only outputs larger than this many bytes. */
  minBytes?: number;
}

export interface Route {
  /** Short name for this route (part of the replay cache key). */
  name?: string;
  match?: RouteMatch;
  /** Arguments for the saver's program (replayed savers); "{command}" is replaced by the recorded shell command. */
  args?: string[];
}

export interface SaverManifest {
  id: string;
  name: string;
  repo: string;
  version: string;
  licence: string;
  method: "replayed" | "upper-bound";
  /** What the saver can act on, in words. */
  covers: string;
  /** Required for upper bounds; optional note otherwise. */
  assumption?: string;
  /** "tool": acts before the agent sees the output (hook), so it gets the full raw output. "request": acts on what was sent (proxy). */
  stage?: "tool" | "request";
  /** Program to run, looked up on PATH and in ~/.saver-audit/tools/bin (replayed). */
  binary?: string;
  /** Arguments that print the version (optional). */
  versionArgs?: string[];
  /** Extra environment; "{state}" becomes a temporary folder for the saver's state. */
  env?: Record<string, string>;
  /** Environment variable that overrides the binary path. */
  binaryEnv?: string;
  /** Extra folders to look in for the binary ("~" is your home folder). */
  paths?: string[];
  /** First matching route wins; no match means the saver does not apply. */
  routes: Route[];
  /** Outputs under this many o200k tokens count as unchanged without replay. */
  minTokens?: number;
  /** Savers acting through Claude Code hooks cannot rewrite tool input on Codex. */
  codexHypothetical?: boolean;
  /** How to install it, shown when it is missing. */
  install?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** Returns a list of problems; empty means the manifest is valid. */
export function validateManifest(m: any): string[] {
  const p: string[] = [];
  const str = (k: string) => typeof m?.[k] === "string" && m[k].trim() !== "";
  if (!m || typeof m !== "object") return ["not a JSON object"];
  if (!str("id") || !ID.test(m.id)) p.push("id: lowercase letters, digits and dashes");
  for (const k of ["name", "repo", "version", "licence", "covers"]) if (!str(k)) p.push(`${k}: required`);
  if (m.method !== "replayed" && m.method !== "upper-bound") p.push('method: "replayed" or "upper-bound" (modeled savers need a cited source, so they are added as code)');
  if (m.method === "upper-bound" && !str("assumption")) p.push("assumption: required for an upper bound (say what the ceiling assumes)");
  if (m.method === "replayed" && !str("binary")) p.push("binary: required for a replayed saver");
  if (m.stage !== undefined && m.stage !== "tool" && m.stage !== "request") p.push('stage: "tool" or "request"');
  if (!Array.isArray(m.routes) || !m.routes.length) p.push("routes: at least one route");
  else
    m.routes.forEach((r: any, i: number) => {
      if (m.method === "replayed" && !Array.isArray(r?.args)) p.push(`routes[${i}].args: required for a replayed saver`);
      if (r?.match?.command !== undefined) {
        try {
          new RegExp(r.match.command);
        } catch {
          p.push(`routes[${i}].match.command: not a valid regular expression`);
        }
      }
    });
  if (m.env && (typeof m.env !== "object" || Object.values(m.env).some((v) => typeof v !== "string"))) p.push("env: an object of strings");
  return p;
}

/** The last real segment of a shell command: drops `cd …&&`, env assignments, wrappers, pipes. */
export function lastSegment(command: string): string | undefined {
  const segments = command.split(/&&|;|\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    let seg = segments[i]!.split("|")[0]!.trim();
    seg = seg.replace(/^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "").replace(/^(sudo|time|env|timeout \S+)\s+/, "");
    if (/^cd\b|^echo\b|^export\b|^source\b/.test(seg)) continue;
    return seg;
  }
  return undefined;
}

const compiled = new WeakMap<RouteMatch, RegExp>();

export function routeMatches(match: RouteMatch | undefined, o: OutputView): boolean {
  if (!match) return true;
  if (match.tools && !match.tools.includes(o.tool)) return false;
  if (match.excludeTools?.includes(o.tool)) return false;
  if (match.categories && !match.categories.includes(o.category)) return false;
  if (match.families && !match.families.includes(o.family)) return false;
  if (match.minBytes !== undefined && Buffer.byteLength(o.text, "utf8") <= match.minBytes) return false;
  if (match.command !== undefined) {
    const seg = o.command ? lastSegment(o.command) : undefined;
    if (!seg) return false;
    let re = compiled.get(match);
    if (!re) compiled.set(match, (re = new RegExp(match.command)));
    if (!re.test(seg)) return false;
  }
  return true;
}

export function findRoute(m: SaverManifest, o: OutputView): Route | undefined {
  return m.routes.find((r) => routeMatches(r.match, o));
}

export interface LoadedManifests {
  manifests: SaverManifest[];
  /** Problems with user manifests, for --verbose and `--check-saver`. */
  problems: string[];
}

export function userSaversDir(): string {
  return join(toolsDir(), "..", "savers");
}

/** Built-in manifests plus the user's own; a user manifest cannot replace a built-in id. */
export function loadManifests(builtin: SaverManifest[], dir = userSaversDir()): LoadedManifests {
  const manifests = [...builtin];
  const problems: string[] = [];
  if (!existsSync(dir)) return { manifests, problems };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    let m: any;
    try {
      m = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      problems.push(`${f}: not valid JSON`);
      continue;
    }
    const errs = validateManifest(m);
    if (errs.length) problems.push(`${f}: ${errs.join("; ")}`);
    else if (manifests.some((x) => x.id === m.id)) problems.push(`${f}: id "${m.id}" is already taken`);
    else manifests.push(m as SaverManifest);
  }
  return { manifests, problems };
}
