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
  /**
   * When the program reports counts instead of printing the filtered text: the JSON
   * field names for its own before/after token counts. The saving is then applied as
   * a ratio to saver-audit's o200k count of the same output (stated in its note).
   */
  jsonRatio?: { before: string; after: string; afterBytes?: string };
}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

const isStr = (v: unknown) => typeof v === "string";
const isStrings = (v: unknown) => Array.isArray(v) && v.every(isStr);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
/** Present but of the wrong type. */
const bad = (v: unknown, ok: (v: unknown) => boolean) => v !== undefined && !ok(v);

/** Returns a list of problems; empty means the manifest is valid. */
export function validateManifest(m: any): string[] {
  const p: string[] = [];
  const str = (k: string) => typeof m?.[k] === "string" && m[k].trim() !== "";
  if (!isObj(m)) return ["not a JSON object"];
  if (!str("id") || !ID.test(m.id)) p.push("id: lowercase letters, digits and dashes");
  for (const k of ["name", "repo", "version", "licence", "covers"]) if (!str(k)) p.push(`${k}: required`);
  if (m.method !== "replayed" && m.method !== "upper-bound") p.push('method: "replayed" or "upper-bound" (modeled savers need a cited source, so they are added as code)');
  if (m.method === "upper-bound" && !str("assumption")) p.push("assumption: required for an upper bound (say what the ceiling assumes)");
  if (m.method === "replayed" && !str("binary")) p.push("binary: required for a replayed saver");
  if (m.stage !== undefined && m.stage !== "tool" && m.stage !== "request") p.push('stage: "tool" or "request"');
  for (const k of ["assumption", "binary", "binaryEnv", "install"]) if (bad(m[k], isStr)) p.push(`${k}: a string`);
  for (const k of ["paths", "versionArgs"]) if (bad(m[k], isStrings)) p.push(`${k}: a list of strings`);
  if (bad(m.minTokens, isNum)) p.push("minTokens: a number");
  if (bad(m.codexHypothetical, (v) => typeof v === "boolean")) p.push("codexHypothetical: true or false");
  if (!Array.isArray(m.routes) || !m.routes.length) p.push("routes: at least one route");
  else
    m.routes.forEach((r: any, i: number) => {
      const at = `routes[${i}]`;
      if (!isObj(r)) return void p.push(`${at}: an object`);
      if (m.method === "replayed" && !Array.isArray(r.args)) p.push(`${at}.args: required for a replayed saver`);
      else if (bad(r.args, isStrings)) p.push(`${at}.args: a list of strings`);
      if (bad(r.name, isStr)) p.push(`${at}.name: a string`);
      if (bad(r.match, isObj)) return void p.push(`${at}.match: an object`);
      for (const k of ["tools", "categories", "families", "excludeTools"]) if (bad(r.match?.[k], isStrings)) p.push(`${at}.match.${k}: a list of strings`);
      if (bad(r.match?.minBytes, isNum)) p.push(`${at}.match.minBytes: a number`);
      if (bad(r.match?.command, isStr)) p.push(`${at}.match.command: a string`);
      else if (r.match?.command !== undefined) {
        try {
          new RegExp(r.match.command);
        } catch {
          p.push(`${at}.match.command: not a valid regular expression`);
        }
      }
    });
  if (bad(m.env, (v) => isObj(v) && Object.values(v as object).every(isStr))) p.push("env: an object of strings");
  if (m.jsonRatio !== undefined && (!isStr(m.jsonRatio?.before) || !isStr(m.jsonRatio?.after) || bad(m.jsonRatio?.afterBytes, isStr))) p.push("jsonRatio: needs `before` and `after` field names (and `afterBytes`, if given, as a name)");
  return p;
}

/** The last real segment of a shell command: drops `cd …&&`, env assignments, wrappers, pipes. */
export function lastSegment(command: string): string | undefined {
  // A line ending in "\" or "|" continues on the next line.
  const joined = command.replace(/[ \t]*\\\r?\n[ \t]*/g, " ").replace(/\|[ \t]*\r?\n/g, "| ");
  const segments = joined.split(/&&|;|\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    let seg = segments[i]!.split("|")[0]!.trim();
    // Env assignments and wrappers, in any order (`env CI=1 vitest`, `time FOO=1 pytest`).
    for (let prev = ""; prev !== seg; ) {
      prev = seg;
      seg = seg.replace(/^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "").replace(/^(sudo|time|env|timeout \S+)\s+/, "");
    }
    if (/^cd\b|^echo\b|^export\b|^source\b/.test(seg)) continue;
    return seg;
  }
  return undefined;
}

const compiled = new WeakMap<RouteMatch, RegExp>();

/** `stage` "tool": sizes are those of the full output (behind a Claude preview), which such a saver acts on. */
export function routeMatches(match: RouteMatch | undefined, o: OutputView, stage?: "tool" | "request"): boolean {
  if (!match) return true;
  if (match.tools && !match.tools.includes(o.tool)) return false;
  if (match.excludeTools?.includes(o.tool)) return false;
  if (match.categories && !match.categories.includes(o.category)) return false;
  if (match.families && !match.families.includes(o.family)) return false;
  if (match.minBytes !== undefined && Buffer.byteLength(stage === "tool" ? (o.raw ?? o.text) : o.text, "utf8") <= match.minBytes) return false;
  if (match.command !== undefined) {
    const seg = o.command ? lastSegment(o.command) : undefined;
    if (!seg) return false;
    let re = compiled.get(match);
    if (!re) compiled.set(match, (re = new RegExp(match.command)));
    if (!re.test(seg)) return false;
  }
  return true;
}

/** Does the route pass the recorded shell command to the program ("{command}" in its args)? */
export function usesCommand(r: Route): boolean {
  return (r.args ?? []).some((a) => a.includes("{command}"));
}

/** A route's arguments for one output: "{command}" becomes its shell command. */
export function routeArgs(r: Route, command: string): string[] {
  return (r.args ?? []).map((a) => a.split("{command}").join(command)); // literal: no "$&" patterns
}

/** The first matching route; one that passes "{command}" only matches outputs with a recorded command. */
export function findRoute(m: SaverManifest, o: OutputView): Route | undefined {
  return m.routes.find((r) => routeMatches(r.match, o, m.stage) && (!!o.command || !usesCommand(r)));
}

export interface LoadedManifests {
  manifests: SaverManifest[];
  /** Problems with user manifests, for --verbose and `--check-saver`. */
  problems: string[];
}

export function userSaversDir(): string {
  return join(toolsDir(), "..", "savers");
}

/**
 * Built-in manifests plus the user's own; a user manifest cannot replace a built-in id,
 * nor a `reserved` one (the savers written as code).
 */
export function loadManifests(builtin: SaverManifest[], dir = userSaversDir(), reserved: string[] = []): LoadedManifests {
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
    else if (manifests.some((x) => x.id === m.id) || reserved.includes(m.id)) problems.push(`${f}: id "${m.id}" is already taken`);
    else manifests.push(m as SaverManifest);
  }
  return { manifests, problems };
}
