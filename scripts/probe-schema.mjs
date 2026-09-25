#!/usr/bin/env node
// Structure-only probe of local agent logs. Prints key paths, value types and counts,
// plus the values of a small whitelist of discriminator fields (record types, model
// names, versions). It never prints text, paths, commands or tool output.
// Keys that are not identifier-shaped (e.g. file paths used as keys) are masked.
//
// usage: node scripts/probe-schema.mjs claude|codex [maxFiles]
import { createReadStream, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

const which = process.argv[2];
const maxFiles = Number(process.argv[3] ?? Infinity);

const ENUM_PATHS = new Set([
  // claude
  "type", "subtype", "entrypoint", "userType", "message.role", "message.model",
  "message.stop_reason", "message.content[].type", "message.content[].content[].type",
  "attachment.type", "message.usage.service_tier", "message.usage.speed",
  "message.usage.iterations[].type", "compactMetadata.trigger", "origin.kind",
  "message.input_transformations[].type", "effort",
  // codex
  "payload.type", "payload.role", "payload.model", "payload.originator", "payload.source",
  "payload.content[].type", "payload.effort", "payload.model_provider", "payload.cli_version",
  "payload.info.last_token_usage", // (object; never an enum, harmless)
]);
// Tool names: recorded only when they are built-ins (no MCP server names).
const TOOL_NAME_PATHS = new Set(["message.content[].name", "payload.name"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_\-]{0,40}$/;

const keyStats = new Map(); // path -> Map(type -> count)
const enumStats = new Map(); // path -> Map(value -> count)
const versions = new Map();
let lines = 0, bad = 0, files = 0;

function bump(map, k, v) {
  let m = map.get(k);
  if (!m) map.set(k, (m = new Map()));
  m.set(v, (m.get(v) ?? 0) + 1);
}
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function walk(v, path, depth) {
  const t = typeOf(v);
  if (path) bump(keyStats, path, t);
  if (path && ENUM_PATHS.has(path) && (t === "string" || t === "boolean")) bump(enumStats, path, String(v));
  if (path && TOOL_NAME_PATHS.has(path) && t === "string") bump(enumStats, path, v.startsWith("mcp__") ? "mcp__<masked>" : v);
  if (depth > 6) return;
  if (t === "array") for (const x of v.slice(0, 50)) walk(x, path + "[]", depth + 1);
  else if (t === "object") {
    const keys = Object.keys(v);
    const dyn = keys.length > 60 || keys.some((k) => !IDENT.test(k));
    for (const k of keys) {
      const name = dyn && !IDENT.test(k) ? "<dyn>" : k;
      walk(v[k], path ? `${path}.${name}` : name, depth + 1);
    }
  }
}

function listFiles(dir, re, out = []) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, re, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}

async function scan(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    let o;
    try { o = JSON.parse(line); } catch { bad++; continue; }
    walk(o, "", 0);
    const ver = o.version ?? (o.type === "session_meta" ? o.payload?.cli_version : undefined);
    if (typeof ver === "string") bump(versions, "v", ver);
  }
}

let fileList;
if (which === "claude") {
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  fileList = listFiles(root, /\.jsonl$/);
} else if (which === "codex") {
  const home = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  fileList = [...listFiles(join(home, "sessions"), /^rollout-.*\.jsonl$/), ...listFiles(join(home, "archived_sessions"), /^rollout-.*\.jsonl$/)];
} else {
  console.error("usage: probe-schema.mjs claude|codex [maxFiles]");
  process.exit(2);
}
fileList.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
for (const f of fileList.slice(0, maxFiles)) { files++; await scan(f); }

console.log(`files=${files} lines=${lines} unparseable=${bad}`);
console.log("versions:", [...(versions.get("v") ?? new Map()).keys()].sort().join(", "));
console.log("\n## enums");
for (const [p, m] of [...enumStats].sort()) {
  console.log(p + ": " + [...m].sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v}=${c}`).join(", "));
}
console.log("\n## key paths (type=count)");
for (const [p, m] of [...keyStats].sort()) {
  console.log(p + "  " + [...m].map(([t, c]) => `${t}=${c}`).join(" "));
}
