#!/usr/bin/env node
// Dev-only: records a demo GIF of a real run. Runs dist/cli.js with the given
// arguments, writes an asciinema v2 recording (command typed out, then the report
// line by line) and renders it with `agg` (https://github.com/asciinema/agg).
// The output is the real report; only the pacing is scripted.
//   node scripts/make-demo-gif.mjs assets/demo.gif --since 2026-08-26 --until 2026-09-25T13:00
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [out, ...args] = process.argv.slice(2);
if (!out) throw new Error("usage: make-demo-gif.mjs <out.gif> [saver-audit args…]");
// The short view is what a terminal shows by default; the menu line below is what an
// interactive run prints after it (the recording cannot wait for keys).
const report = execFileSync(process.execPath, ["dist/cli.js", "--short", "--no-card", ...args], {
  encoding: "utf8",
  env: { ...process.env, FORCE_COLOR: "1" },
  maxBuffer: 1 << 26,
});

const WIDTH = 100;
const MENU = "\x1b[1;33m[f]\x1b[0m full report   \x1b[1;33m[s]\x1b[0m share on X   \x1b[1;33m[o]\x1b[0m open card   \x1b[1;33m[q]\x1b[0m quit";
const lines = [...report.replace(/\n$/, "").split("\n"), "Share card: \x1b[1msaver-audit.png\x1b[0m", "", MENU];
const events = [];
let t = 0.6;
const emit = (s) => events.push([Number(t.toFixed(3)), "o", s]);
const shown = `npx saver-audit ${args.join(" ")}`.trim();
emit("\x1b[1;32m$\x1b[0m ");
for (const ch of shown) {
  t += 0.06;
  emit(ch);
}
t += 0.5;
emit("\r\n");
t += 1.2; // the real run takes a few seconds; shortened here
for (const line of lines) {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  t += plain.trim() === "" ? 0.5 : /^\S/.test(plain) ? 0.35 : 0.1;
  emit(line + "\r\n");
}
t += 5;
emit("");
const HEIGHT = 30; // the report scrolls; the last screen holds on the saver table and caveats
const header = { version: 2, width: WIDTH, height: HEIGHT, env: { TERM: "xterm-256color" } };
const cast = out.replace(/\.gif$/, ".cast");
writeFileSync(cast, [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join("\n") + "\n");
// Optional still of the final screen, to check the ending: PREVIEW=path.gif
if (process.env.PREVIEW) {
  const still = [JSON.stringify(header), ...events.map((e) => JSON.stringify([0.001, "o", e[2]])), JSON.stringify([2, "o", ""])];
  const pc = process.env.PREVIEW.replace(/\.gif$/, ".cast");
  writeFileSync(pc, still.join("\n") + "\n");
  execFileSync("agg", ["--font-size", "14", "--theme", "monokai", pc, process.env.PREVIEW], { stdio: ["ignore", "ignore", "inherit"] });
}
execFileSync("agg", ["--font-size", "14", "--theme", "monokai", "--idle-time-limit", "6", cast, out], { stdio: ["ignore", "ignore", "inherit"] });
console.log(`wrote ${out} (${t.toFixed(1)} s)`);
