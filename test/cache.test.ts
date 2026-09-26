import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultReplayCachePath } from "../src/savers/cache.ts";

function withCacheHome<T>(value: string | undefined, fn: () => T): T {
  const old = process.env.XDG_CACHE_HOME;
  if (value === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = value;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = old;
  }
}

test("an empty or relative XDG_CACHE_HOME falls back to ~/.cache, never the working folder", () => {
  const home = join(homedir(), ".cache", "saver-audit", "replay-v1.json");
  for (const v of [undefined, "", "rel/dir"]) assert.equal(withCacheHome(v, defaultReplayCachePath), home, JSON.stringify(v));
  assert.equal(withCacheHome("/abs/cache", defaultReplayCachePath), join("/abs/cache", "saver-audit", "replay-v1.json"));
});
