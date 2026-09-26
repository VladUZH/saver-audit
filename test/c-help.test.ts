// --help names every saver and everything --install-savers downloads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SAVERS } from "../src/savers/registry.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const help = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });

test("--help lists every built-in saver id", () => {
  const savers = help.slice(help.indexOf("Savers:"));
  for (const s of SAVERS) assert.match(savers, new RegExp(`\\b${s.id}\\b`), s.id);
});

test("--help names every download of --install-savers, and does not call headroom's verified", () => {
  const flag = help.slice(help.indexOf("--install-savers"), help.indexOf("-y, --yes"));
  for (const name of ["rtk", "caveman engine", "token-saver", "lean-ctx"]) assert.match(flag, new RegExp(name), name);
  const headroom = flag.slice(flag.indexOf("--with-headroom"));
  assert.match(headroom, /not verified/);
});
