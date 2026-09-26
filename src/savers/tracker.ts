// Per-file saver bookkeeping, run inside the parsing workers.
//
// Every tool output becomes a block holding, per saver, the o200k tokens that saver
// removes from it (`d`). Blocks are kept per context timeline, and each API call
// records which blocks were already in context (ctxStart..newStart) and which are new
// (newStart..newEnd). Pricing later turns this into compounding savings: a removed
// token is a cache write when first sent and a cache read on every later call until
// compaction. Replayed savers resolve `d` from the cache or leave a ReplayJob.
import { createHash } from "node:crypto";
import { countProxy } from "../accounting/tokens.ts";
import { splitCodexHeader, type SaverAdapter } from "./registry.ts";
import type { OutputView, ReplayJob } from "./types.ts";

/** Per saver: the o200k tokens (calibrated later) it removes from one block. */
export interface SaverBlock {
  d: number[];
}

export interface CallRange {
  tl: string;
  ctxStart: number;
  newStart: number;
  newEnd: number;
  /** First call in this timeline (a prompt-level addition is new, not cached, here). */
  first: boolean;
}

/** A cached replay result: tokens of the saver's output, its length, and tokens of its first 2,000 chars. */
export interface ReplayResult {
  t: number;
  c: number;
  p: number;
}

export type ReplayLookup = (key: string) => ReplayResult | undefined;

export const INLINE_LIMIT_CHARS = 30_000; // Claude Code Bash output limit (tech-notes §0.4)
export const PREVIEW_CHARS = 2_000;

interface TimelineBlocks {
  blocks: SaverBlock[];
  ctxStart: number;
  pendStart: number;
  calls: number;
}

/**
 * Earlier releases cached a failed run as "unchanged", indistinguishable from a real
 * result. Savers run as one process per output (where a broken install fails every
 * output, and a re-run is cheap) get new keys; headroom keeps its costly results, except
 * on Windows, where it was sent non-ASCII text in the wrong encoding.
 */
const keySalt = (id: string) => (id !== "headroom" ? "#2" : process.platform === "win32" ? "#w" : "");

/**
 * The saver version a result is cached under: the installed one when it differs from the
 * adapter's (same test as the report's version note), so an upgraded saver is measured
 * again while results from a matching install stay valid.
 */
export function keyVersion(adapter: string, installed?: string): string {
  return installed && installed !== "version unknown" && !adapter.startsWith(installed) ? installed : adapter;
}

export function replayKey(saver: SaverAdapter, tool: string, arg: string | undefined, input: string, installed?: string): string {
  const v = keyVersion(saver.version, installed);
  return createHash("sha256").update(`${saver.id}@${v}${keySalt(saver.id)}\0${tool}\0${arg ?? ""}\0`).update(input).digest("base64url").slice(0, 32);
}

/**
 * Tokens the model would see after the saver: its output, re-presented as a
 * <persisted-output> preview when it is still over the inline limit and the original
 * was a preview too.
 */
export function presentedTokens(res: ReplayResult, job: Pick<ReplayJob, "persistedHeader" | "headerTokens" | "addTokens">): number {
  if (job.persistedHeader !== undefined && res.c > INLINE_LIMIT_CHARS) return job.headerTokens + res.p + job.addTokens;
  return res.t + job.addTokens;
}

/** The "<persisted-output> … Preview (first NKB):" header of a Claude Code preview. */
export function persistedHeader(text: string): string {
  const m = /^<persisted-output>[\s\S]*?Preview \(first [^)\n]*\):\n/.exec(text);
  if (m) return m[0];
  const nl = text.indexOf("\n");
  return nl > 0 ? text.slice(0, nl + 1) : text;
}

export class SaverTracker {
  readonly timelines: Record<string, TimelineBlocks> = {};
  readonly jobs: ReplayJob[] = [];
  /** Per saver: o200k tokens of tool output it could act on; and all tool-output tokens. */
  readonly covered: number[];
  toolTokens = 0;
  readonly savers: SaverAdapter[];
  private replayable: Set<string>;
  private lookup: ReplayLookup;
  private until?: string;
  private versions: Record<string, string>;

  constructor(savers: SaverAdapter[], replayable: Set<string>, lookup: ReplayLookup, until?: string, versions: Record<string, string> = {}) {
    this.until = until;
    this.versions = versions;
    this.savers = savers;
    this.replayable = replayable;
    this.lookup = lookup;
    this.covered = savers.map(() => 0);
  }

  private tl(name: string): TimelineBlocks {
    return (this.timelines[name] ??= { blocks: [], ctxStart: 0, pendStart: 0, calls: 0 });
  }

  private zero(): SaverBlock {
    return { d: this.savers.map(() => 0) };
  }

  compact(timeline: string): void {
    const t = this.tl(timeline);
    t.ctxStart = t.blocks.length;
    t.pendStart = t.blocks.length;
  }

  /**
   * The context goes back to what it was right after the call with this range (none:
   * the start). Its blocks are appended again, as the same objects, so replay results
   * written to the originals count here too.
   */
  rewind(timeline: string, range: CallRange | undefined): void {
    if (!range || range.tl !== timeline) return this.compact(timeline);
    const t = this.tl(timeline);
    const start = t.blocks.length;
    t.blocks.push(...t.blocks.slice(range.ctxStart, range.newEnd));
    t.ctxStart = start;
    t.pendStart = t.blocks.length;
  }

  output(timeline: string, timestamp: string | undefined, o: OutputView): void {
    const t = this.tl(timeline);
    const block = this.zero();
    const index = t.blocks.length;
    t.blocks.push(block);
    // Context only flows forward: an output after the period end can reach no call in
    // the period, so it is neither replayed nor counted in coverage.
    if (this.until && timestamp && timestamp > this.until) return;
    this.toolTokens += o.tokens;
    this.savers.forEach((s, i) => {
      if (!s.appliesTo(o)) return;
      this.covered[i]! += o.tokens;
      if (s.ceiling) {
        block.d[i] = s.ceiling(o);
        return;
      }
      if (!s.replayInput || !this.replayable.has(s.id)) return;
      // Tool-stage savers (hooks like rtk) see the full output before the agent does:
      // the size floor applies to that, not to a Claude preview of it; a Codex shell
      // header is kept around their output, and a Claude preview may be re-presented as
      // a preview if their output is still too long.
      const toolStage = s.stage === "tool";
      const full = toolStage && o.raw !== undefined;
      if (s.minTokens && o.tokens < s.minTokens && !(full && countProxy(o.raw!) >= s.minTokens)) return; // counted as unchanged
      const inp = s.replayInput(o);
      if (!inp || !inp.input) return;
      const key = replayKey(s, o.tool, inp.arg, inp.input, this.versions[s.id]);
      const header = toolStage && o.source === "codex" && !o.raw ? splitCodexHeader(o.text).header : "";
      const persisted = full ? persistedHeader(o.text) : undefined;
      const job: ReplayJob = {
        saver: s.id,
        key,
        tool: o.tool,
        arg: inp.arg,
        args: inp.args,
        input: inp.input,
        cls: `${o.category}|${o.family}`,
        baseline: o.tokens,
        persistedHeader: persisted,
        headerTokens: persisted ? countProxy(persisted) : 0,
        addTokens: header ? countProxy(header) : 0,
        timeline,
        block: index,
      };
      // Every replayable output becomes a job so the main thread can draw the same
      // deterministic sample every run; cached ones travel without their text.
      if (this.lookup(key)) job.input = "";
      this.jobs.push(job);
    });
  }

  /** Marks a call's block range; returns it for the CallRecord. */
  call(timeline: string): CallRange {
    const t = this.tl(timeline);
    const range = { tl: timeline, ctxStart: t.ctxStart, newStart: t.pendStart, newEnd: t.blocks.length, first: t.calls++ === 0 };
    t.pendStart = range.newEnd;
    return range;
  }
}
