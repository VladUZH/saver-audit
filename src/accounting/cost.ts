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
 * Splits a call's prompt (tokens and cost) across content buckets. Content already in
 * context fills the cache-read part first; new content and any overflow go to the
 * fresh part (uncached input + cache write). If the estimates exceed the recorded
 * prompt they are scaled down; what is left goes to RESIDUAL (system prompt, tool
 * definitions and other context that is not in the logs).
 */
export function attribute(rec: CallRecord, k: number, cost: CallCost): Map<BucketKey, Share> {
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

  const out = new Map<BucketKey, Share>();
  const put = (b: BucketKey, tokens: number, c: number) => {
    const cur = out.get(b);
    if (cur) {
      cur.tokens += tokens;
      cur.cost += c;
    } else out.set(b, { tokens, cost: c });
  };
  const old = (b: BucketKey, x: number) => {
    if (!oldTotal) return;
    const f = x / oldTotal;
    const inRead = f * oldInRead;
    const inFresh = f * oldInFresh * s;
    put(b, inRead + inFresh, inRead * rRead + inFresh * rFresh);
  };
  for (const b in rec.oldRaw) old(b, rec.oldRaw[b]! * k);
  old("assistant", rec.oldReal);
  for (const b in rec.newRaw) put(b, rec.newRaw[b]! * k * s, rec.newRaw[b]! * k * s * rFresh);
  if (rec.newReal) put("assistant", rec.newReal * s, rec.newReal * s * rFresh);

  let tokens = 0;
  let spent = 0;
  for (const v of out.values()) {
    tokens += v.tokens;
    spent += v.cost;
  }
  const promptCost = cost.input + cost.cacheWrite + cost.cacheRead;
  put(RESIDUAL, Math.max(0, readTok + freshTok - tokens), Math.max(0, promptCost - spent));
  return out;
}
