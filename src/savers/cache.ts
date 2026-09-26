// Persistent replay cache: content hash → token counts of a saver's output.
// Holds hashes and numbers only, never text, so it reveals nothing about the logs.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ReplayLookup, ReplayResult } from "./tracker.ts";

const FORMAT = 1;

/** $XDG_CACHE_HOME, or ~/.cache when it is unset, empty or relative (as the XDG spec says). */
export function cacheHome(): string {
  const x = process.env.XDG_CACHE_HOME;
  return x && isAbsolute(x) ? x : join(homedir(), ".cache");
}

export function defaultReplayCachePath(): string {
  return join(cacheHome(), "saver-audit", "replay-v1.json");
}

const loaded = new Map<string, Map<string, ReplayResult>>();

export function readReplayCache(file: string | undefined): Map<string, ReplayResult> {
  if (!file) return new Map();
  const hit = loaded.get(file);
  if (hit) return hit;
  const map = new Map<string, ReplayResult>();
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (doc?.format === FORMAT && doc.entries && typeof doc.entries === "object") {
      for (const [k, v] of Object.entries<any>(doc.entries)) {
        if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number")) map.set(k, { t: v[0], c: v[1], p: v[2] });
      }
    }
  } catch {
    // no cache yet, or unreadable: start empty
  }
  loaded.set(file, map);
  return map;
}

export function loadReplayCache(file: string | undefined): ReplayLookup {
  const map = readReplayCache(file);
  return (key) => map.get(key);
}

/** Best effort (the cache only saves time): returns an error code instead of throwing. */
export function saveReplayCache(file: string, entries: Map<string, ReplayResult>): string | undefined {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const out: Record<string, [number, number, number]> = {};
    for (const [k, v] of entries) out[k] = [v.t, v.c, v.p];
    writeFileSync(tmp, JSON.stringify({ format: FORMAT, entries: out }));
    renameSync(tmp, file);
    return undefined;
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // nothing more to do
    }
    return (err as NodeJS.ErrnoException).code ?? "unknown error";
  }
}

/**
 * The last quick draw per saver, kept next to the replay cache so a repeat run over the same
 * logs reuses it: hashes and numbers only (a population fingerprint, the cache fingerprint
 * when that run ended, the salt, and the drawn outputs' content hashes).
 */
export interface QuickDraw {
  pop: string;
  cache: string;
  salt: string;
  drawn: string[];
}

const DRAWS_FORMAT = 1;

export function quickDrawsPath(cacheFile: string): string {
  return join(dirname(cacheFile), "quick-draws-v1.json");
}

/** The stored draws; empty when there are none or the file is unreadable or malformed. */
export function readQuickDraws(file: string): Map<string, QuickDraw> {
  const out = new Map<string, QuickDraw>();
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (doc?.format !== DRAWS_FORMAT || !doc.draws || typeof doc.draws !== "object") return out;
    for (const [saver, d] of Object.entries<any>(doc.draws)) {
      const str = (x: unknown) => typeof x === "string";
      if (d && str(d.pop) && str(d.cache) && str(d.salt) && Array.isArray(d.drawn) && d.drawn.every(str)) out.set(saver, { pop: d.pop, cache: d.cache, salt: d.salt, drawn: d.drawn });
    }
  } catch {
    // none yet, or unreadable: every saver draws afresh
  }
  return out;
}

/** Best effort, like the replay cache: returns an error code instead of throwing. */
export function saveQuickDraws(file: string, draws: Map<string, QuickDraw>): string | undefined {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ format: DRAWS_FORMAT, draws: Object.fromEntries(draws) }));
    renameSync(tmp, file);
    return undefined;
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // nothing more to do
    }
    return (err as NodeJS.ErrnoException).code ?? "unknown error";
  }
}
