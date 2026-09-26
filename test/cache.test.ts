import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultReplayCachePath, keyPrefix, quickDrawsPath, readQuickDraws, saveQuickDraws } from "../src/savers/cache.ts";

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

test("the quick-draw store round-trips its compact encoding and ignores anything malformed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-draws-"));
  try {
    const file = quickDrawsPath(join(dir, "replay-v1.json"));
    const keys = Array.from({ length: 50 }, (_, i) => `k${String(i).padStart(3, "0")}AbCdEfGhIjKlMnOpQrStUvWx-_`);
    const draw = { cache: "3:ab:cd", salt: "s", budget: 270, unit: "usd", x: new Map(keys.map((k, i) => [keyPrefix(k), 0.123456789 * (i + 1)])), drawn: new Set(keys.slice(0, 7).map(keyPrefix)) };
    assert.equal(saveQuickDraws(file, new Map([["token-saver", draw]])), undefined);
    const back = readQuickDraws(file).get("token-saver")!;
    assert.deepEqual({ ...back, x: [...back.x.keys()], drawn: [...back.drawn] }, { ...draw, x: [...draw.x.keys()], drawn: [...draw.drawn] });
    assert.ok([...back.x.values()].every((v, i) => Math.abs(v / (0.123456789 * (i + 1)) - 1) < 0.003), "sizes kept to 0.3%");
    assert.ok(readFileSync(file, "utf8").length < 57 * 11 + 200, "11 characters an output");
    for (const bad of ["{not json", JSON.stringify({ format: 2, draws: { "token-saver": { ...JSON.parse(readFileSync(file, "utf8")).draws["token-saver"], x: "abc" } } }), JSON.stringify({ format: 1, draws: {} })]) {
      writeFileSync(file, bad);
      assert.equal(readQuickDraws(file).size, 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
