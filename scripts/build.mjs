// Bundles src/cli.ts (and the o200k_base tokenizer it imports) into dist/cli.js.
// Zero runtime dependencies: everything the CLI needs ends up in dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});

// --card assets, loaded only when a card is requested.
mkdirSync("dist/fonts", { recursive: true });
cpSync("node_modules/@resvg/resvg-wasm/index_bg.wasm", "dist/resvg.wasm");
for (const f of ["JetBrainsMono-Regular.ttf", "JetBrainsMono-Bold.ttf", "OFL.txt"]) cpSync(`assets/fonts/${f}`, `dist/fonts/${f}`);
