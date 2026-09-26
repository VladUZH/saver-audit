// Orchestration: files → call records → dedupe → calibrate → price → aggregate.
import { ContextTracker, type BucketKey, type CallRecord } from "./accounting/buckets.ts";
import { attribute, callCost, contextRates, RESIDUAL, type CallCost } from "./accounting/cost.ts";
import { calibrate, type Calibration } from "./accounting/tokens.ts";
import { findClaudeFiles, parseClaudeFile } from "./sources/claude-code.ts";
import { findCodexFiles, parseCodexFile } from "./sources/codex.ts";
import { promptTokens, type Session, type Source, type SourceEvent } from "./sources/types.ts";
import { ratesFor, resolveModel, type PriceTable } from "./prices/table.ts";
import { CAVEMAN_SKILL_OUTPUT_CUT, CAVEMAN_SKILL_TOKENS, saverIndex, type SaverAdapter } from "./savers/registry.ts";
import type { ReplayStats, ReplayTool } from "./savers/replay.ts";
import { SaverTracker, type SaverBlock } from "./savers/tracker.ts";
import { loadReplayCache } from "./savers/cache.ts";
import type { ReplayJob } from "./savers/types.ts";
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
  savers?: FileSavers;
}

/** Saver data from one file: per-timeline blocks, unresolved replays, coverage. */
export interface FileSavers {
  timelines: Record<string, { blocks: SaverBlock[] }>;
  jobs: ReplayJob[];
  covered: number[];
  toolTokens: number;
}

/** Which savers to audit, passed to the parsing workers. */
export interface SaverConfig {
  ids: string[];
  /** Replayed savers whose binary is installed. */
  replayable: string[];
  cacheFile?: string;
  /** ISO end of the period: outputs after it cannot reach an in-period call. */
  until?: string;
  /** Installed versions of the replayed savers (part of their replay cache keys). */
  versions?: Record<string, string>;
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

export interface SaverRow {
  id: string;
  name: string;
  repo: string;
  method: "replayed" | "modeled" | "upper-bound";
  /** Saver version the adapter matches. */
  version: string;
  licence: string;
  /** Replayed savers: the installed version, or undefined when not installed. */
  installed?: string;
  status: "ok" | "not installed";
  covers: string;
  assumption?: string;
  /** Share of tool-output tokens the saver could act on. */
  coverage: number;
  /** Billed tokens saved, re-reads included (negative = the saver adds tokens). */
  tokens: number;
  cost: number;
  /** Part of `cost` from Codex sessions (hypothetical when codexHypothetical). */
  codexCost: number;
  codexHypothetical: boolean;
  replay?: ReplayStats;
  /** Unique outputs the replayed saver applies to (sampled + extrapolated). */
  replayTotal?: number;
  /** How to install it (from its manifest), shown when it is missing. */
  install?: string;
}

/** Saver audit inputs gathered by the caller (tool detection, replay stats). */
export interface SaverRun {
  savers: SaverAdapter[];
  tools: Map<string, ReplayTool>;
  stats: Map<string, ReplayStats>;
}

export interface AuditResult {
  period: { since: string; until: string };
  /** Timestamps of the first and last counted call (the span the logs cover), if any has one. */
  covered?: { first: string; last: string };
  looked: string[];
  sources: Source[];
  files: number;
  /** bySource counts main sessions; `sources` has every source with a counted call, subagent runs included. */
  sessions: { main: number; subagent: number; bySource: Record<string, number>; sources: Source[] };
  calls: number;
  models: ModelRow[];
  billing: { input: Amount; cacheWrite: Amount; cacheRead: Amount; output: Amount; webSearch: { requests: number; cost: number }; total: Amount };
  buckets: BucketRow[];
  waste: WasteRow[];
  projects: string[];
  calibration: Calibration[];
  savers: SaverRow[];
  prices: { date: string; sources: string[] };
  skipped: { lines: number; unreadableFiles: number; duplicateCalls: number; outsidePeriod: number; notBillable: number };
}

export async function processFile(file: string, source: Source, index: number, savers?: SaverConfig): Promise<FileResult> {
  const st = savers && savers.ids.length ? new SaverTracker(saverIndex(savers.ids), new Set(savers.replayable), loadReplayCache(savers.cacheFile), savers.until, savers.versions) : undefined;
  const tracker = new ContextTracker(index, source, st);
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
  if (st) res.savers = { timelines: st.timelines, jobs: st.jobs, covered: st.covered, toolTokens: st.toolTokens };
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

const NO_COST: CallCost = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, webSearch: 0 };

function amount(): Amount {
  return { tokens: 0, cost: 0 };
}

/** Prefix sums of a timeline's saver deltas: pd (o200k, ×k later) and pr (real tokens). */
function prefixes(blocks: SaverBlock[], n: number): { pd: number[][]; pr: number[][] } {
  const pd = Array.from({ length: n }, () => new Array<number>(blocks.length + 1).fill(0));
  const pr = Array.from({ length: n }, () => new Array<number>(blocks.length + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < blocks.length; b++) {
      pd[i]![b + 1] = pd[i]![b]! + blocks[b]!.d[i]!;
      pr[i]![b + 1] = pr[i]![b]! + blocks[b]!.r[i]!;
    }
  }
  return { pd, pr };
}

export function summarize(opts: AuditOptions, results: FileResult[], saverRun?: SaverRun): AuditResult {
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

  const since = new Date(opts.sinceMs).toISOString();
  const until = new Date(opts.untilMs).toISOString();
  const inPeriod = (rec: CallRecord) => !rec.timestamp || (rec.timestamp >= since && rec.timestamp <= until);

  // Calibrate on unique calls in the period with a comparable predecessor, so the same
  // period always gives the same fit.
  const pairs = [];
  for (const rec of records) {
    if (!rec.prev || !inPeriod(rec)) continue;
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
  let first = "";
  let last = "";
  const savers = saverRun?.savers ?? [];
  const saved = savers.map(() => ({ tokens: 0, cost: 0, codexCost: 0 }));
  const prefixCache = new Map<string, { pd: number[][]; pr: number[][] }>();
  const skillIdx = savers.findIndex((sv) => sv.id === "caveman-skill");
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
    if (!inPeriod(rec)) {
      outsidePeriod++;
      continue;
    }
    counted.add(rec.file);
    if (rec.timestamp && (!first || rec.timestamp < first)) first = rec.timestamp;
    if (rec.timestamp && rec.timestamp > last) last = rec.timestamp;
    const u = rec.call.usage;
    const prompt = promptTokens(u);
    const priced = resolveModel(opts.prices, rec.model, rec.timestamp);
    // One row per model and price: an alias split by date (codex-auto-review) can be priced as two models.
    const mk = `${rec.model}\0${priced ?? ""}`;
    let row = models.get(mk);
    if (!row) models.set(mk, (row = { model: rec.model, pricedAs: priced, calls: 0, tokens: 0, cost: 0 }));
    row.calls++;
    row.tokens += prompt + u.output;

    billing.input.tokens += u.input;
    billing.cacheWrite.tokens += u.cacheWrite;
    billing.cacheRead.tokens += u.cacheRead;
    billing.output.tokens += u.output;
    billing.webSearch.requests += u.webSearches;
    // Unpriced model: tokens still count (context split, savers), dollars do not.
    const c = priced ? callCost(u, ratesFor(opts.prices.models[priced]!, prompt), rec.call.multiplier) : NO_COST;
    const callTotal = c.input + c.cacheWrite + c.cacheRead + c.output + c.webSearch;
    row.cost += callTotal;
    billing.input.cost += c.input;
    billing.cacheWrite.cost += c.cacheWrite;
    billing.cacheRead.cost += c.cacheRead;
    billing.output.cost += c.output;
    billing.webSearch.cost += c.webSearch;
    const k = calib.get(rec.model)!.k;
    for (const [key, share] of attribute(rec, k, c)) addBucket(key, share.tokens, share.cost, rec.file);
    const fs = results[rec.file]?.savers;
    if (savers.length && rec.range && fs) {
      const tl = fs.timelines[rec.range.tl];
      const pk = `${rec.file}\0${rec.range.tl}`;
      let pre = prefixCache.get(pk);
      if (!pre && tl) prefixCache.set(pk, (pre = prefixes(tl.blocks, savers.length)));
      const rates = contextRates(rec, k, c);
      const { ctxStart, newStart, newEnd } = rec.range;
      const codex = results[rec.file]!.source === "codex";
      for (let i = 0; i < savers.length; i++) {
        let tok = 0;
        let usd = 0;
        if (pre) {
          const oldD = k * (pre.pd[i]![newStart]! - pre.pd[i]![ctxStart]!) + (pre.pr[i]![newStart]! - pre.pr[i]![ctxStart]!);
          const newD = k * (pre.pd[i]![newEnd]! - pre.pd[i]![newStart]!) + (pre.pr[i]![newEnd]! - pre.pr[i]![newStart]!);
          tok += oldD * rates.oldTokens + newD * rates.newTokens;
          usd += oldD * rates.oldCost + newD * rates.newCost;
        }
        if (i === skillIdx) {
          // Output style: fewer output tokens now; the skill text is in every prompt.
          tok += u.output * CAVEMAN_SKILL_OUTPUT_CUT;
          usd += c.output * CAVEMAN_SKILL_OUTPUT_CUT;
          const overhead = CAVEMAN_SKILL_TOKENS * k;
          tok -= overhead * (rec.range.first ? rates.newTokens : rates.oldTokens);
          usd -= overhead * (rec.range.first ? rates.newCost : rates.oldCost);
        }
        saved[i]!.tokens += tok;
        saved[i]!.cost += usd;
        if (codex) saved[i]!.codexCost += usd;
      }
    }
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

  const sessions = { main: 0, subagent: 0, bySource: {} as Record<string, number>, sources: [] as Source[] };
  const projects = new Set<string>();
  const active = new Set<Source>();
  for (const i of counted) {
    const src = results[i]?.source;
    if (src) active.add(src);
    const s = results[i]?.session;
    if (!s) continue;
    if (s.isSubagent) sessions.subagent++;
    else {
      sessions.main++;
      sessions.bySource[s.source] = (sessions.bySource[s.source] ?? 0) + 1;
    }
    if (s.project) projects.add(s.project);
  }
  sessions.sources = (["claude-code", "codex"] as Source[]).filter((x) => active.has(x));

  const countedModels = new Set([...models.values()].map((m) => m.model));
  return {
    period: { since, until },
    covered: first ? { first, last } : undefined,
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
    calibration: modelNames.filter((m) => countedModels.has(m)).map((m) => calib.get(m)!),
    savers: saverRows(savers, saved, results, saverRun),
    prices: { date: opts.prices.date, sources: opts.prices.sources },
    skipped: { lines: results.reduce((n, r) => n + r.skippedLines, 0), unreadableFiles: results.filter((r) => r.unreadable).length, duplicateCalls, outsidePeriod, notBillable },
  };
}

function saverRows(savers: SaverAdapter[], saved: Array<{ tokens: number; cost: number; codexCost: number }>, results: FileResult[], run?: SaverRun): SaverRow[] {
  let toolTokens = 0;
  const covered = savers.map(() => 0);
  for (const r of results) {
    if (!r.savers) continue;
    toolTokens += r.savers.toolTokens;
    r.savers.covered.forEach((n, i) => (covered[i]! += n));
  }
  return savers.map((sv, i) => {
    const tool = run?.tools.get(sv.id);
    const notInstalled = sv.method === "replayed" && !tool;
    return {
      id: sv.id,
      name: sv.name,
      repo: sv.repo,
      method: sv.method,
      version: sv.version,
      licence: sv.licence,
      installed: sv.method === "replayed" && tool ? tool.version ?? "version unknown" : undefined,
      status: notInstalled ? "not installed" : "ok",
      covers: sv.covers,
      assumption: sv.assumption,
      coverage: toolTokens ? covered[i]! / toolTokens : 0,
      tokens: notInstalled ? 0 : saved[i]!.tokens,
      cost: notInstalled ? 0 : saved[i]!.cost,
      codexCost: notInstalled ? 0 : saved[i]!.codexCost,
      codexHypothetical: sv.codexHypothetical,
      replay: run?.stats.get(sv.id),
      replayTotal: run?.stats.get(sv.id)?.total,
      install: sv.manifest?.install,
    };
  });
}
