// Orchestration: files → call records → dedupe → calibrate → price → aggregate.
import { ContextTracker, type BucketKey, type CallRecord } from "./accounting/buckets.ts";
import { attribute, callCost, RESIDUAL } from "./accounting/cost.ts";
import { calibrate, type Calibration } from "./accounting/tokens.ts";
import { findClaudeFiles, parseClaudeFile } from "./sources/claude-code.ts";
import { findCodexFiles, parseCodexFile } from "./sources/codex.ts";
import { promptTokens, type Session, type Source, type SourceEvent } from "./sources/types.ts";
import { ratesFor, resolveModel, type PriceTable } from "./prices/table.ts";
import { join } from "node:path";

export interface AuditOptions {
  sinceMs: number;
  untilMs: number;
  sources: Source[];
  claudeRoots: string[];
  codexHome: string;
  prices: PriceTable;
}

export interface FileResult {
  file: string;
  source: Source;
  session?: Session;
  records: CallRecord[];
  skippedLines: number;
  unreadable?: boolean;
}

export interface Amount {
  tokens: number;
  cost: number;
}

export interface BucketRow extends Amount {
  key: BucketKey;
  label: string;
  group: "context" | "output" | "fees";
}

export interface WasteRow extends Amount {
  label: string;
  projects: string[];
}

export interface ModelRow extends Amount {
  model: string;
  pricedAs?: string;
  calls: number;
}

export interface AuditResult {
  period: { since: string; until: string };
  looked: string[];
  sources: Source[];
  files: number;
  sessions: { main: number; subagent: number; bySource: Record<string, number> };
  calls: number;
  models: ModelRow[];
  billing: { input: Amount; cacheWrite: Amount; cacheRead: Amount; output: Amount; webSearch: { requests: number; cost: number }; total: Amount };
  buckets: BucketRow[];
  waste: WasteRow[];
  projects: string[];
  calibration: Calibration[];
  prices: { date: string; sources: string[] };
  skipped: { lines: number; unreadableFiles: number; duplicateCalls: number; outsidePeriod: number; notBillable: number };
}

export async function processFile(file: string, source: Source, index: number): Promise<FileResult> {
  const tracker = new ContextTracker(index);
  const res: FileResult = { file, source, records: tracker.records, skippedLines: 0 };
  const events: AsyncGenerator<SourceEvent> = source === "claude-code" ? parseClaudeFile(file) : parseCodexFile(file);
  try {
    for await (const ev of events) {
      if (ev.t === "turn") tracker.turn(ev.turn);
      else if (ev.t === "compact") tracker.compact(ev.timeline);
      else if (ev.t === "session") res.session = ev.session;
      else if (ev.t === "skip") res.skippedLines++;
    }
  } catch {
    // Unreadable file (deleted mid-run, permissions): keep what was parsed.
    res.unreadable = true;
  }
  return res;
}

export function findFiles(opts: AuditOptions): Array<{ file: string; source: Source }> {
  const out: Array<{ file: string; source: Source }> = [];
  if (opts.sources.includes("claude-code")) for (const f of findClaudeFiles(opts.claudeRoots, opts.sinceMs)) out.push({ file: f, source: "claude-code" });
  if (opts.sources.includes("codex")) for (const f of findCodexFiles(opts.codexHome, opts.sinceMs)) out.push({ file: f, source: "codex" });
  return out;
}

export function lookedIn(opts: AuditOptions): string[] {
  const out: string[] = [];
  if (opts.sources.includes("claude-code")) out.push(...opts.claudeRoots);
  if (opts.sources.includes("codex")) out.push(join(opts.codexHome, "sessions"), join(opts.codexHome, "archived_sessions"));
  return out;
}

const LABELS: Record<string, string> = {
  prompt: "Your prompts",
  injected: "Reminders, attachments & command output",
  system: "Recorded system prompt & instructions",
  compaction: "Compaction summaries",
  assistant: "Earlier assistant turns, re-read",
  [RESIDUAL]: "Not in logs: system prompt, tool definitions",
  output: "Assistant output (incl. thinking)",
  fees: "Web search fees",
};

export function bucketLabel(key: BucketKey): string {
  if (key.startsWith("tool:")) return `Tool output: ${key.slice(5).split("|")[0]}`;
  return LABELS[key] ?? key;
}

export function wasteLabel(key: BucketKey): string {
  const [cat, fam] = key.slice(5).split("|");
  return fam ? `${cat}: ${fam}` : cat!;
}

function amount(): Amount {
  return { tokens: 0, cost: 0 };
}

export function summarize(opts: AuditOptions, results: FileResult[]): AuditResult {
  // Dedupe calls across and within files; keep the copy with the largest totals.
  const byKey = new Map<string, CallRecord>();
  let duplicateCalls = 0;
  for (const r of results) {
    for (const rec of r.records) {
      const cur = byKey.get(rec.key);
      if (!cur) byKey.set(rec.key, rec);
      else {
        duplicateCalls++;
        const size = (x: CallRecord) => promptTokens(x.call.usage) + x.call.usage.output;
        if (size(rec) > size(cur)) byKey.set(rec.key, rec);
      }
    }
  }
  const records = [...byKey.values()];

  // Calibrate on every unique call with a comparable predecessor.
  const pairs = [];
  for (const rec of records) {
    if (!rec.prev) continue;
    const appended = promptTokens(rec.call.usage) - promptTokens(rec.prev.call.usage) - rec.prev.call.usage.output;
    pairs.push({ model: rec.model, appended, proxy: rec.proxyAppended });
  }
  const modelNames = [...new Set(records.map((r) => r.model))].sort();
  const calib = calibrate(pairs, modelNames);

  const billing = { input: amount(), cacheWrite: amount(), cacheRead: amount(), output: amount(), webSearch: { requests: 0, cost: 0 }, total: amount() };
  const buckets = new Map<BucketKey, { tokens: number; cost: number; projects: Set<number> }>();
  const models = new Map<string, ModelRow>();
  const counted = new Set<number>();
  let outsidePeriod = 0;
  let notBillable = 0;
  const since = new Date(opts.sinceMs).toISOString();
  const until = new Date(opts.untilMs).toISOString();

  const addBucket = (key: BucketKey, tokens: number, cost: number, file: number) => {
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { tokens: 0, cost: 0, projects: new Set() }));
    b.tokens += tokens;
    b.cost += cost;
    b.projects.add(file);
  };

  for (const rec of records) {
    if (!rec.call.billable) {
      notBillable++;
      continue;
    }
    if (rec.timestamp && (rec.timestamp < since || rec.timestamp > until)) {
      outsidePeriod++;
      continue;
    }
    counted.add(rec.file);
    const u = rec.call.usage;
    const prompt = promptTokens(u);
    const priced = resolveModel(opts.prices, rec.model, rec.timestamp);
    let row = models.get(rec.model);
    if (!row) models.set(rec.model, (row = { model: rec.model, pricedAs: priced, calls: 0, tokens: 0, cost: 0 }));
    row.calls++;
    row.tokens += prompt + u.output;

    billing.input.tokens += u.input;
    billing.cacheWrite.tokens += u.cacheWrite;
    billing.cacheRead.tokens += u.cacheRead;
    billing.output.tokens += u.output;
    billing.webSearch.requests += u.webSearches;
    if (!priced) {
      // Unpriced model: tokens still count, dollars do not.
      addBucket("output", u.output, 0, rec.file);
      continue;
    }
    const c = callCost(u, ratesFor(opts.prices.models[priced]!, prompt), rec.call.multiplier);
    const callTotal = c.input + c.cacheWrite + c.cacheRead + c.output + c.webSearch;
    row.cost += callTotal;
    billing.input.cost += c.input;
    billing.cacheWrite.cost += c.cacheWrite;
    billing.cacheRead.cost += c.cacheRead;
    billing.output.cost += c.output;
    billing.webSearch.cost += c.webSearch;
    for (const [key, share] of attribute(rec, calib.get(rec.model)!.k, c)) addBucket(key, share.tokens, share.cost, rec.file);
    addBucket("output", u.output, c.output, rec.file);
    if (u.webSearches) addBucket("fees", 0, c.webSearch, rec.file);
  }
  billing.total.tokens = billing.input.tokens + billing.cacheWrite.tokens + billing.cacheRead.tokens + billing.output.tokens;
  billing.total.cost = billing.input.cost + billing.cacheWrite.cost + billing.cacheRead.cost + billing.output.cost + billing.webSearch.cost;

  const projectOf = (file: number) => results[file]?.session?.project ?? "(unknown)";
  const bucketRows: BucketRow[] = [];
  const categoryRows = new Map<string, BucketRow>();
  const waste: WasteRow[] = [];
  for (const [key, b] of buckets) {
    const label = bucketLabel(key);
    const group = key === "output" ? "output" : key === "fees" ? "fees" : "context";
    let row = categoryRows.get(label);
    if (!row) categoryRows.set(label, (row = { key: key.startsWith("tool:") ? `tool:${key.slice(5).split("|")[0]}` : key, label, group, tokens: 0, cost: 0 }));
    row.tokens += b.tokens;
    row.cost += b.cost;
    if (key.startsWith("tool:")) waste.push({ label: wasteLabel(key), tokens: b.tokens, cost: b.cost, projects: [...new Set([...b.projects].map(projectOf))].sort() });
  }
  bucketRows.push(...categoryRows.values());
  bucketRows.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  waste.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

  const sessions = { main: 0, subagent: 0, bySource: {} as Record<string, number> };
  const projects = new Set<string>();
  for (const i of counted) {
    const s = results[i]?.session;
    if (!s) continue;
    if (s.isSubagent) sessions.subagent++;
    else {
      sessions.main++;
      sessions.bySource[s.source] = (sessions.bySource[s.source] ?? 0) + 1;
    }
    if (s.project) projects.add(s.project);
  }

  return {
    period: { since, until },
    looked: lookedIn(opts),
    sources: opts.sources,
    files: results.length,
    sessions,
    calls: [...models.values()].reduce((n, m) => n + m.calls, 0),
    models: [...models.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
    billing,
    buckets: bucketRows,
    waste,
    projects: [...projects].sort(),
    calibration: modelNames.filter((m) => models.has(m)).map((m) => calib.get(m)!),
    prices: { date: opts.prices.date, sources: opts.prices.sources },
    skipped: { lines: results.reduce((n, r) => n + r.skippedLines, 0), unreadableFiles: results.filter((r) => r.unreadable).length, duplicateCalls, outsidePeriod, notBillable },
  };
}
