// Persistent replay cache: content hash → token counts of a saver's output.
// Holds hashes and numbers only, never text, so it reveals nothing about the logs.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ReplayLookup, ReplayResult } from "./tracker.ts";

const FORMAT = 1;

export function defaultReplayCachePath(): string {
  const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(cache, "saver-audit", "replay-v1.json");
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

export function saveReplayCache(file: string, entries: Map<string, ReplayResult>): void {
  mkdirSync(dirname(file), { recursive: true });
  const out: Record<string, [number, number, number]> = {};
  for (const [k, v] of entries) out[k] = [v.t, v.c, v.p];
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ format: FORMAT, entries: out }));
  renameSync(tmp, file);
}
