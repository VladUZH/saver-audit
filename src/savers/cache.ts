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
 * The last quick draw per saver, kept next to the replay cache so a later run over (nearly)
 * the same outputs reuses it. Hashes and numbers only: the salt, the cache fingerprint when
 * that run ended, and, for comparing populations and keeping the draw, each output's size
 * and the outputs drawn under this salt, keyed by the first KEY_CHARS characters of their
 * content hash. Sizes are kept on a log scale to 0.3% in 3 characters, so an output costs 11
 * characters (about 10k outputs per saver: ~110 KB).
 */
export interface QuickDraw {
  cache: string;
  salt: string;
  budget: number;
  unit: string;
  /** Size of each output of that run's population, by key prefix (outputs of size 0 are not kept). */
  x: Map<string, number>;
  /** Key prefixes of every output drawn (and measured) under this salt. */
  drawn: Set<string>;
}

/** Characters of a content hash kept in the draw store (48 bits: a collision among 20k outputs is ~1 in a million, and would only blur an overlap). */
export const KEY_CHARS = 8;
export const keyPrefix = (key: string) => key.slice(0, KEY_CHARS).padEnd(KEY_CHARS, "~");

const DRAWS_FORMAT = 2;

export function quickDrawsPath(cacheFile: string): string {
  return join(dirname(cacheFile), "quick-draws-v1.json");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** A positive size as 3 characters: round(256·log2 x), offset to 18 bits. */
const encodeX = (x: number) => {
  const q = Math.min(2 ** 18 - 1, Math.max(0, Math.round(Math.log2(x) * 256) + 2 ** 17));
  return B64[q >> 12]! + B64[(q >> 6) & 63]! + B64[q & 63]!;
};
const decodeX = (s: string) => 2 ** (((B64.indexOf(s[0]!) << 12) + (B64.indexOf(s[1]!) << 6) + B64.indexOf(s[2]!) - 2 ** 17) / 256);
const split = (s: string) => Array.from({ length: Math.ceil(s.length / KEY_CHARS) }, (_, i) => s.slice(i * KEY_CHARS, (i + 1) * KEY_CHARS));

/** The stored draws; empty when there are none or the file is unreadable or malformed. */
export function readQuickDraws(file: string): Map<string, QuickDraw> {
  const out = new Map<string, QuickDraw>();
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (doc?.format !== DRAWS_FORMAT || !doc.draws || typeof doc.draws !== "object") return out;
    for (const [saver, d] of Object.entries<any>(doc.draws)) {
      const str = (v: unknown): v is string => typeof v === "string";
      if (!d || !str(d.cache) || !str(d.salt) || !str(d.unit) || typeof d.budget !== "number" || !str(d.x) || !str(d.drawn)) continue;
      if (d.x.length % (KEY_CHARS + 3) || d.drawn.length % KEY_CHARS || !/^[\w~-]*$/.test(d.x + d.drawn)) continue;
      const x = new Map<string, number>();
      for (let i = 0; i < d.x.length; i += KEY_CHARS + 3) x.set(d.x.slice(i, i + KEY_CHARS), decodeX(d.x.slice(i + KEY_CHARS, i + KEY_CHARS + 3)));
      out.set(saver, { cache: d.cache, salt: d.salt, budget: d.budget, unit: d.unit, x, drawn: new Set(split(d.drawn)) });
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
    const doc = Object.fromEntries(
      [...draws].map(([saver, d]) => [
        saver,
        {
          cache: d.cache,
          salt: d.salt,
          budget: d.budget,
          unit: d.unit,
          // Outputs of size 0 weigh nothing in an overlap: left out.
          x: [...d.x].filter(([, v]) => v > 0).map(([k, v]) => keyPrefix(k) + encodeX(v)).join(""),
          drawn: [...d.drawn].map(keyPrefix).join(""),
        },
      ]),
    );
    writeFileSync(tmp, JSON.stringify({ format: DRAWS_FORMAT, draws: doc }));
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
