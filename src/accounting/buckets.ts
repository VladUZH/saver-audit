// Where tokens go. Each API call's prompt is split between content that was new
// since the previous call (billed as cache write / uncached input) and content already
// in context (billed mostly as cache reads). Content is tracked per bucket as o200k
// counts; calibration and prices are applied later in attribute().
import { toolCategory } from "./categories.ts";
import { countProxy } from "./tokens.ts";
import type { Block, Call, Source, Turn, UserKind } from "../sources/types.ts";
import type { CallRange, SaverTracker } from "../savers/tracker.ts";

/** Bucket keys: fixed labels, or `tool:<Category>|<shell family>`. */
export type BucketKey = string;

export interface CallRecord {
  key: string;
  model: string;
  timestamp?: string;
  call: Call;
  file: number;
  /** o200k counts of user-side content already in context / new since the previous call. */
  oldRaw: Record<BucketKey, number>;
  newRaw: Record<BucketKey, number>;
  /** Earlier assistant output still in context / added since the previous call (recorded tokens). */
  oldReal: number;
  newReal: number;
  /** Calibration: previous call in the same context and model, if any. */
  prev?: CallRecord;
  proxyAppended: number;
  /** Saver block range, when savers are being audited. */
  range?: CallRange;
}

interface Timeline {
  ctxRaw: Record<BucketKey, number>;
  ctxReal: number;
  pendRaw: Record<BucketKey, number>;
  pendReal: number;
  prev?: CallRecord;
  /** Thinking in ctxReal / pendReal that the next prompt drops (recorded tokens), and the o200k count of the visible output that stays. */
  think: number;
  thinkVis: number;
  pendThink: number;
  pendVis: number;
}

function fresh(): Timeline {
  return { ctxRaw: {}, ctxReal: 0, pendRaw: {}, pendReal: 0, think: 0, thinkVis: 0, pendThink: 0, pendVis: 0 };
}

function add(into: Record<string, number>, from: Record<string, number>): void {
  for (const k in from) into[k] = (into[k] ?? 0) + from[k]!;
}

/**
 * Claude models before Opus 4.5 and Sonnet 4.6, and Haiku 4.5 and older, drop earlier
 * turns' thinking from the prompt when a new user prompt arrives; within a tool loop it
 * stays (tech-notes §4.2). Newer, unknown and non-Claude models keep it.
 */
export function dropsThinking(model: string): boolean {
  if (/claude-[23]-/.test(model)) return true;
  const m = /claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:\D|$)/.exec(model);
  if (!m) return false;
  const version = Number(m[2]) * 100 + (m[3] ? Number(m[3]) : 0);
  return version < (m[1] === "opus" ? 405 : 406);
}

/** o200k count of what a response shows besides thinking: its text and tool calls. */
function visibleTokens(turn: Turn): number {
  let n = 0;
  for (const b of turn.blocks) {
    if (b.kind === "text") n += countProxy(b.text);
    else if (b.kind === "tool_use") n += countProxy(`${b.tool} ${JSON.stringify(b.input) ?? ""}`);
  }
  return n;
}

export function blockBucket(block: Block, userKind: UserKind | undefined): BucketKey | undefined {
  if (block.kind === "tool_result") return `tool:${toolCategory(block.tool)}|${block.family}`;
  if (block.kind !== "text") return undefined;
  switch (userKind) {
    case "prompt":
      return "prompt";
    case "system":
      return "system";
    case "compaction-summary":
      return "compaction";
    default:
      return "injected";
  }
}

/** Streams one file's turns into per-call records. */
export class ContextTracker {
  readonly records: CallRecord[] = [];
  private timelines = new Map<string, Timeline>();
  /** Thinking state right after a call (think, thinkVis, pendThink, pendVis), when any. */
  private thinkAfter = new Map<string, [number, number, number, number]>();
  private file: number;
  private source: Source;
  private savers?: SaverTracker;

  constructor(file: number, source: Source = "claude-code", savers?: SaverTracker) {
    this.file = file;
    this.source = source;
    this.savers = savers;
  }

  private tl(name: string): Timeline {
    let t = this.timelines.get(name);
    if (!t) this.timelines.set(name, (t = fresh()));
    return t;
  }

  compact(timeline: string): void {
    this.timelines.set(timeline, fresh());
    this.savers?.compact(timeline);
  }

  /**
   * The context goes back to what it was right after call `key` (null: the start).
   * User-side content logged between that call and the prompt is not restored. Saver
   * blocks cannot be restored this way, so savers restart their context as after a compaction.
   */
  private rewind(timeline: string, key: string | null): void {
    const t = fresh();
    const rec = key === null ? undefined : this.records.findLast((r) => r.key === key);
    if (rec) {
      t.ctxRaw = { ...rec.oldRaw };
      add(t.ctxRaw, rec.newRaw);
      t.ctxReal = rec.oldReal + rec.newReal;
      t.pendReal = rec.call.usage.output;
      const th = this.thinkAfter.get(rec.key);
      if (th) [t.think, t.thinkVis, t.pendThink, t.pendVis] = th;
    }
    this.timelines.set(timeline, t);
    this.savers?.compact(timeline);
  }

  turn(turn: Turn): void {
    if (turn.rewind !== undefined) this.rewind(turn.timeline, turn.rewind);
    const t = this.tl(turn.timeline);
    if (turn.role === "user") {
      if (turn.userKind === "prompt" && (t.think || t.pendThink)) {
        // Earlier thinking leaves the context; the visible output stays, counted as o200k.
        t.ctxReal -= t.think;
        t.pendReal -= t.pendThink;
        if (t.thinkVis) t.ctxRaw.assistant = (t.ctxRaw.assistant ?? 0) + t.thinkVis;
        if (t.pendVis) t.pendRaw.assistant = (t.pendRaw.assistant ?? 0) + t.pendVis;
        t.think = t.thinkVis = t.pendThink = t.pendVis = 0;
        t.prev = undefined; // the prompt did not grow by the previous output: no calibration pair
      }
      for (const b of turn.blocks) {
        const bucket = blockBucket(b, turn.userKind);
        if (!bucket) continue;
        const n = countProxy(b.kind === "text" || b.kind === "tool_result" ? b.text : "");
        if (n) t.pendRaw[bucket] = (t.pendRaw[bucket] ?? 0) + n;
        if (this.savers && b.kind === "tool_result" && b.text) {
          this.savers.output(turn.timeline, turn.timestamp, {
            source: this.source,
            tool: b.tool,
            category: toolCategory(b.tool),
            family: b.family,
            command: b.command,
            text: b.text,
            raw: b.raw,
            tokens: n,
          });
        }
      }
      return;
    }
    const call = turn.call;
    if (!call) return; // Codex writes the model's own items before its token_count
    let proxyAppended = 0;
    for (const k in t.pendRaw) proxyAppended += t.pendRaw[k]!;
    const rec: CallRecord = {
      key: call.key,
      model: call.model,
      timestamp: turn.timestamp,
      call,
      file: this.file,
      oldRaw: { ...t.ctxRaw },
      newRaw: t.pendRaw,
      oldReal: t.ctxReal,
      newReal: t.pendReal,
      prev: t.prev && t.prev.model === call.model ? t.prev : undefined,
      proxyAppended,
      range: this.savers?.call(turn.timeline, call.usage.output),
    };
    this.records.push(rec);
    add(t.ctxRaw, t.pendRaw);
    t.ctxReal += t.pendReal;
    t.think += t.pendThink;
    t.thinkVis += t.pendVis;
    t.pendRaw = {};
    // This call's output is in context from the next call on.
    t.pendReal = call.usage.output;
    t.pendThink = t.pendVis = 0;
    if (dropsThinking(call.model) && (turn.thinking || call.usage.reasoning > 0)) {
      // Without a logged thinking count, the whole output gives way to its visible part.
      t.pendThink = call.usage.reasoning || call.usage.output;
      t.pendVis = call.usage.reasoning ? 0 : visibleTokens(turn);
    }
    if (t.think || t.pendThink) this.thinkAfter.set(call.key, [t.think, t.thinkVis, t.pendThink, t.pendVis]);
    t.prev = rec;
  }
}
