// Cost of one API call from its recorded usage, and its split across content buckets.
import type { Rates } from "../prices/table.ts";
import type { Usage } from "../sources/types.ts";
import type { BucketKey, CallRecord } from "./buckets.ts";

export const WEB_SEARCH_USD = 10 / 1000; // $10 per 1k searches (tech-notes §1.3)

export interface CallCost {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  webSearch: number;
}

const M = 1e6;

export function callCost(u: Usage, r: Rates, multiplier: number): CallCost {
  const write5m = u.cacheWrite - u.cacheWrite1h;
  return {
    input: (u.input * r.input * multiplier) / M,
    cacheWrite: ((write5m * r.cacheWrite + u.cacheWrite1h * r.cacheWrite1h) * multiplier) / M,
    cacheRead: (u.cacheRead * r.cacheRead * multiplier) / M,
    output: (u.output * r.output * multiplier) / M,
    webSearch: u.webSearches * WEB_SEARCH_USD,
  };
}

export interface Share {
  tokens: number;
  cost: number;
}

/** Bucket for prompt tokens not attributable to logged content. */
export const RESIDUAL = "residual";

/**
 * Per-token prompt rates for one call. Content already in context fills the
 * cache-read part first; new content and any overflow go to the fresh part (uncached
 * input + cache write). If the estimates exceed the recorded prompt they are scaled
 * down by `scale`.
 */
export interface ContextRates {
  /** USD per (calibrated) token of content already in context / new in this call. */
  oldCost: number;
  newCost: number;
  /** Billed tokens per estimated token (≤ 1 when estimates were scaled down). */
  oldTokens: number;
  newTokens: number;
  oldTotal: number;
  newTotal: number;
}

export function contextRates(rec: CallRecord, k: number, cost: CallCost): ContextRates {
  const u = rec.call.usage;
  const readTok = u.cacheRead;
  const freshTok = u.input + u.cacheWrite;
  const rRead = readTok ? cost.cacheRead / readTok : 0;
  const rFresh = freshTok ? (cost.input + cost.cacheWrite) / freshTok : 0;
  let oldTotal = rec.oldReal;
  for (const b in rec.oldRaw) oldTotal += rec.oldRaw[b]! * k;
  let newTotal = rec.newReal;
  for (const b in rec.newRaw) newTotal += rec.newRaw[b]! * k;
  const oldInRead = Math.min(oldTotal, readTok);
  const oldInFresh = oldTotal - oldInRead;
  const freshNeed = oldInFresh + newTotal;
  const s = freshNeed > freshTok ? freshTok / freshNeed : 1;
  // With no old content, an old token would be a cache read (if any) at the read rate.
  const oldCost = oldTotal ? (oldInRead * rRead + oldInFresh * s * rFresh) / oldTotal : readTok ? rRead : rFresh;
  const oldTokens = oldTotal ? (oldInRead + oldInFresh * s) / oldTotal : 1;
  return { oldCost, newCost: s * rFresh, oldTokens, newTokens: s, oldTotal, newTotal };
}

/**
 * Splits a call's prompt (tokens and cost) across content buckets using
 * contextRates(); what is left goes to RESIDUAL (system prompt, tool definitions and
 * other context that is not in the logs).
 */
export function attribute(rec: CallRecord, k: number, cost: CallCost): Map<BucketKey, Share> {
  const u = rec.call.usage;
  const r = contextRates(rec, k, cost);
  const out = new Map<BucketKey, Share>();
  const put = (b: BucketKey, tokens: number, c: number) => {
    const cur = out.get(b);
    if (cur) {
      cur.tokens += tokens;
      cur.cost += c;
    } else out.set(b, { tokens, cost: c });
  };
  for (const b in rec.oldRaw) {
    const x = rec.oldRaw[b]! * k;
    put(b, x * r.oldTokens, x * r.oldCost);
  }
  if (rec.oldReal) put("assistant", rec.oldReal * r.oldTokens, rec.oldReal * r.oldCost);
  for (const b in rec.newRaw) {
    const x = rec.newRaw[b]! * k;
    put(b, x * r.newTokens, x * r.newCost);
  }
  if (rec.newReal) put("assistant", rec.newReal * r.newTokens, rec.newReal * r.newCost);

  let tokens = 0;
  let spent = 0;
  for (const v of out.values()) {
    tokens += v.tokens;
    spent += v.cost;
  }
  const promptCost = cost.input + cost.cacheWrite + cost.cacheRead;
  put(RESIDUAL, Math.max(0, u.cacheRead + u.input + u.cacheWrite - tokens), Math.max(0, promptCost - spent));
  return out;
}
