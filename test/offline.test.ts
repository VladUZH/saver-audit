import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "../src/pool.ts";
import { fixtureOptions } from "./helpers.ts";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED = new Set(["prices/update.ts"]); // only reached with --update-prices
const NETWORK = /\bfetch\s*\(|from\s+["']node:(http|https|http2|net|tls|dgram|dns)["']|from\s+["'](http|https|net|undici|axios|node-fetch)["']|WebSocket|XMLHttpRequest/;

function files(dir: string, rel = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]));
}

test("runtime code never touches the network outside --update-prices", () => {
  const offenders = files(SRC).filter((f) => !ALLOWED.has(f) && NETWORK.test(readFileSync(join(SRC, f), "utf8")));
  assert.deepEqual(offenders, []);
  const cli = readFileSync(join(SRC, "cli.ts"), "utf8");
  assert.match(cli, /if \(values\["update-prices"\]\) \{\s*const \{ updatePrices \} = await import\("\.\/prices\/update\.ts"\)/, "update module loaded only behind the flag");
});

test("an audit run makes no fetch call", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("network");
  }) as typeof fetch;
  try {
    await runAudit(fixtureOptions(), undefined, 1);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(calls, 0);
});
