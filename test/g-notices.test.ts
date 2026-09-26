// THIRD_PARTY_NOTICES.md must say which npm packages end up inside dist/cli.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("the notices name every package bundled into dist/cli.js", async () => {
  // Same bundling as scripts/build.mjs, in memory.
  const r = await build({ absWorkingDir: ROOT, entryPoints: ["src/cli.ts"], outfile: "out/cli.js", bundle: true, platform: "node", format: "esm", target: "node20", write: false, metafile: true, logLevel: "silent" });
  const bundled = new Set<string>();
  for (const [path, input] of Object.entries(r.metafile.outputs["out/cli.js"]!.inputs)) {
    const m = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m && input.bytesInOutput > 0) bundled.add(m[1]!);
  }
  assert.ok(bundled.has("gpt-tokenizer"));
  const paragraphs = readFileSync(`${ROOT}THIRD_PARTY_NOTICES.md`, "utf8").split(/\n\s*\n/);
  for (const pkg of bundled) {
    assert.ok(paragraphs.some((p) => p.includes("dist/cli.js") && p.includes(pkg)), `${pkg} is bundled into dist/cli.js, but no notice says so`);
  }
});
