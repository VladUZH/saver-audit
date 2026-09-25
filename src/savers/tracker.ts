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
import { CAVEMAN_SKILL_OUTPUT_CUT, splitCodexHeader, type SaverAdapter } from "./registry.ts";
import type { OutputView, ReplayJob } from "./types.ts";

/** Per-saver token deltas for one block: proxy (o200k, calibrated later) and real tokens. */
export interface SaverBlock {
  d: number[];
  r: number[];
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

export function replayKey(saver: SaverAdapter, tool: string, arg: string | undefined, input: string): string {
  return createHash("sha256").update(`${saver.id}@${saver.version}\0${tool}\0${arg ?? ""}\0`).update(input).digest("base64url").slice(0, 32);
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
  private skillIdx: number;

  constructor(savers: SaverAdapter[], replayable: Set<string>, lookup: ReplayLookup) {
    this.savers = savers;
    this.replayable = replayable;
    this.lookup = lookup;
    this.covered = savers.map(() => 0);
    this.skillIdx = savers.findIndex((s) => s.id === "caveman-skill");
  }

  private tl(name: string): TimelineBlocks {
    return (this.timelines[name] ??= { blocks: [], ctxStart: 0, pendStart: 0, calls: 0 });
  }

  private zero(): SaverBlock {
    return { d: this.savers.map(() => 0), r: this.savers.map(() => 0) };
  }

  compact(timeline: string): void {
    const t = this.tl(timeline);
    t.ctxStart = t.blocks.length;
    t.pendStart = t.blocks.length;
  }

  output(timeline: string, o: OutputView): void {
    const t = this.tl(timeline);
    const block = this.zero();
    const index = t.blocks.length;
    t.blocks.push(block);
    this.toolTokens += o.tokens;
    this.savers.forEach((s, i) => {
      if (!s.appliesTo(o)) return;
      this.covered[i]! += o.tokens;
      if (s.ceiling) {
        block.d[i] = s.ceiling(o);
        return;
      }
      if (!s.replayInput || !this.replayable.has(s.id)) return;
      const inp = s.replayInput(o);
      if (!inp || !inp.input) return;
      const key = replayKey(s, o.tool, inp.arg, inp.input);
      // Codex shell output keeps its Exit code / Wall time header around rtk's output.
      const header = s.id === "rtk" && o.source === "codex" && !o.raw ? splitCodexHeader(o.text).header : "";
      const persisted = o.raw !== undefined && s.id === "rtk" ? persistedHeader(o.text) : undefined;
      const job: ReplayJob = {
        saver: s.id,
        key,
        tool: o.tool,
        arg: inp.arg,
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
  call(timeline: string, output: number): CallRange {
    const t = this.tl(timeline);
    const range = { tl: timeline, ctxStart: t.ctxStart, newStart: t.pendStart, newEnd: t.blocks.length, first: t.calls++ === 0 };
    // Output-style saver: part of this call's output is never written, so it is also
    // never re-read by later calls in this context.
    if (this.skillIdx >= 0 && output > 0) {
      const b = this.zero();
      b.r[this.skillIdx] = output * CAVEMAN_SKILL_OUTPUT_CUT;
      t.blocks.push(b);
    }
    t.pendStart = range.newEnd;
    return range;
  }
}
