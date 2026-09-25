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
}

function add(into: Record<string, number>, from: Record<string, number>): void {
  for (const k in from) into[k] = (into[k] ?? 0) + from[k]!;
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
    if (!t) this.timelines.set(name, (t = { ctxRaw: {}, ctxReal: 0, pendRaw: {}, pendReal: 0 }));
    return t;
  }

  compact(timeline: string): void {
    this.timelines.set(timeline, { ctxRaw: {}, ctxReal: 0, pendRaw: {}, pendReal: 0 });
    this.savers?.compact(timeline);
  }

  turn(turn: Turn): void {
    const t = this.tl(turn.timeline);
    if (turn.role === "user") {
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
    t.pendRaw = {};
    // This call's output is in context from the next call on.
    t.pendReal = call.usage.output;
    t.prev = rec;
  }
}
