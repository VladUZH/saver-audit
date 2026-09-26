import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import snapshot from "../data/prices.json" with { type: "json" };
import { userPricesPath } from "../src/prices/load.ts";
import { fixtureOptions } from "./helpers.ts";

/** A temp XDG cache dir holding `table` where --update-prices saves it. */
function savedTable(table: object): string {
  const dir = mkdtempSync(join(tmpdir(), "sa-b-"));
  mkdirSync(join(dir, "saver-audit"));
  writeFileSync(join(dir, "saver-audit", "prices.json"), JSON.stringify(table));
  return dir;
}

test("test fixtures price with data/prices.json, not a table --update-prices saved on this machine", () => {
  const newer = { ...snapshot, date: "2999-01-01", models: { ...snapshot.models, "claude-opus-5-5": { ...snapshot.models["claude-opus-5-5"], input: 99 } } };
  process.env.XDG_CACHE_HOME = savedTable(newer);
  const prices = fixtureOptions().prices;
  assert.equal(prices.date, snapshot.date);
  assert.equal(prices.models["claude-opus-5-5"]!.input, snapshot.models["claude-opus-5-5"].input);
});

test("an empty or relative XDG_CACHE_HOME falls back to ~/.cache, never the current directory", () => {
  const saved = process.env.XDG_CACHE_HOME;
  try {
    for (const x of ["", "rel", "./rel"]) {
      process.env.XDG_CACHE_HOME = x;
      assert.equal(userPricesPath(), join(homedir(), ".cache", "saver-audit", "prices.json"), JSON.stringify(x));
    }
    process.env.XDG_CACHE_HOME = join(tmpdir(), "xdg");
    assert.equal(userPricesPath(), join(tmpdir(), "xdg", "saver-audit", "prices.json"));
    assert.ok(isAbsolute(userPricesPath()));
  } finally {
    if (saved === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = saved;
  }
});
