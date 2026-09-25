#!/usr/bin/env node
// Independent cross-check for M1: sums deduplicated recorded usage straight from the
// logs, without saver-audit's parser, and compares with `saver-audit --json`.
// Prints totals only.
//   node scripts/crosscheck-usage.mjs [days=30]
import { execFileSync } from "node:child_process";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const days = Number(process.argv[2] ?? 30);
const now = Date.now();
const since = now - days * 864e5;
const sinceIso = new Date(since).toISOString();
const untilIso = new Date(now).toISOString();

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (statSync(p).mtimeMs >= since) out.push(p);
  }
  return out;
}
async function* lines(file) {
  for await (const l of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!l) continue;
    try { yield JSON.parse(l); } catch { /* skip */ }
  }
}
const n = (v) => (typeof v === "number" && v > 0 ? v : 0);

// Claude Code: max per field per message.id|requestId, first-seen timestamp.
const claude = new Map();
const claudeRoot = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
for (const f of walk(claudeRoot).filter((f) => f.endsWith(".jsonl") && !basename(f).includes(".orphaned-"))) {
  for await (const o of lines(f)) {
    if (o.type !== "assistant" || !o.message?.usage || typeof o.message.id !== "string") continue;
    if (o.message.model === "<synthetic>" || o.isApiErrorMessage) continue;
    const k = `${o.message.id}|${o.requestId ?? ""}`;
    const u = o.message.usage;
    const cur = claude.get(k) ?? { ts: o.timestamp, in: 0, cw: 0, cr: 0, out: 0 };
    cur.in = Math.max(cur.in, n(u.input_tokens));
    cur.cw = Math.max(cur.cw, n(u.cache_creation_input_tokens));
    cur.cr = Math.max(cur.cr, n(u.cache_read_input_tokens));
    cur.out = Math.max(cur.out, n(u.output_tokens));
    claude.set(k, cur);
  }
}
const sum = { in: 0, cw: 0, cr: 0, out: 0 };
for (const c of claude.values()) {
  if (c.ts && (c.ts < sinceIso || c.ts > untilIso)) continue;
  sum.in += c.in; sum.cw += c.cw; sum.cr += c.cr; sum.out += c.out;
}

// Codex: last_token_usage when the cumulative total changed; skip replayed fork history.
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const live = walk(join(codexHome, "sessions")).filter((f) => /^rollout-.*\.jsonl$/.test(basename(f)));
const names = new Set(live.map((f) => basename(f)));
const archived = walk(join(codexHome, "archived_sessions")).filter((f) => /^rollout-.*\.jsonl$/.test(basename(f)) && !names.has(basename(f)));
for (const f of [...live, ...archived]) {
  let prev = -1;
  let billable = true;
  for await (const o of lines(f)) {
    const p = o.payload;
    if (o.type === "session_meta") { if (p?.forked_from_id || p?.parent_thread_id) billable = false; continue; }
    if (o.type === "inter_agent_communication_metadata" && p?.trigger_turn === true) billable = true;
    if (o.type !== "event_msg") continue;
    if (p?.type === "task_started") billable = true;
    if (p?.type !== "token_count" || !p.info) continue;
    const t = p.info.total_token_usage?.total_tokens;
    if (typeof t === "number" && t === prev) continue;
    if (typeof t === "number") prev = t;
    const u = p.info.last_token_usage ?? {};
    const input = n(u.input_tokens), cached = Math.min(input, n(u.cached_input_tokens)), out = n(u.output_tokens);
    if (!billable || (input === 0 && out === 0)) continue;
    if (o.timestamp && (o.timestamp < sinceIso || o.timestamp > untilIso)) continue;
    const cw = Math.min(input - cached, n(u.cache_write_input_tokens));
    sum.in += input - cached - cw; sum.cr += cached; sum.cw += cw; sum.out += out;
  }
}

const report = JSON.parse(execFileSync(process.execPath, ["dist/cli.js", "--json", "--last", `${days}d`], { encoding: "utf8", maxBuffer: 1 << 26 }));
const b = report.billing;
const rows = [
  ["input", sum.in, b.input.tokens],
  ["cache write", sum.cw, b.cacheWrite.tokens],
  ["cache read", sum.cr, b.cacheRead.tokens],
  ["output", sum.out, b.output.tokens],
  ["total", sum.in + sum.cw + sum.cr + sum.out, b.total.tokens],
];
let worst = 0;
for (const [label, ref, got] of rows) {
  const diff = ref ? (got - ref) / ref : 0;
  worst = Math.max(worst, Math.abs(diff));
  console.log(`${label.padEnd(12)} reference ${String(ref).padStart(14)}  saver-audit ${String(got).padStart(14)}  diff ${(diff * 100).toFixed(3)}%`);
}
console.log(worst <= 0.01 ? "PASS: within 1%" : "FAIL: more than 1% apart");
process.exitCode = worst <= 0.01 ? 0 : 1;
