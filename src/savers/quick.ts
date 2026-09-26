// Quick-mode estimator (tech-notes §8.13): which outputs a quick run replays, and how the
// saving of the others is estimated from them. Pure: no I/O, no clock, no saver processes.
//
// Per saver, over the outputs of the period:
//  - Outputs cached when the run starts are exact and leave the population. The rest (U) is
//    sampled with a salt that changes whenever the cache does, so a sample never depends on
//    which outputs an earlier run happened to replay.
//  - <persisted-output> previews go first (up to half the budget). The model saw a preview
//    but the saver gets the full output, so they never set a ratio, and an unmeasured one
//    means no number.
//  - The other n outputs are drawn with probability proportional to size x (tokens over every
//    occurrence): π = min(1, c·x) with Σπ = n. Outputs with c·x ≥ 1 are certainties; the rest
//    are ranked by u/x (sequential Poisson sampling, u a salted hash in (0,1)), a rank that does
//    not depend on n, so any prefix of it is itself a valid sample.
//  - Unmeasured outputs get R_g·x, where R_g = Σw·d / Σw·x over the sampled non-certain outputs
//    of their size band and w = (1 − π)/π: the weight of the part that was NOT measured.
//  - The standard error of the total is √Σ (1 − π)/π² · (d − R_g·x)².
import { createHash } from "node:crypto";

/** Fewer sampled outputs than this to estimate from: no number, just "press [e]". */
export const MIN_QUICK_SAMPLE = 20;

export interface QuickOutput {
  key: string;
  /** Size: tokens the model saw, summed over every occurrence of the output in the period. */
  x: number;
  /** A <persisted-output> preview. */
  preview: boolean;
}

export interface QuickPlan {
  /** Every uncached output in replay order: previews, certainties (largest first), then by u/x; previews beyond half the budget last. */
  order: string[];
  /** How many of `order` a quick run replays (the budget, or fewer when U is smaller). */
  quick: number;
  /** The certainties at the planned budget (every non-preview output when they all fit). */
  certain: Set<string>;
  /** Non-certain non-preview outputs of U, in u/x order. */
  ranked: string[];
  /** Uncached previews. */
  previews: Set<string>;
  /** Every preview in the population, cached or not. */
  allPreviews: Set<string>;
  /**
   * Uncached outputs of size 0: worth nothing in the period (no priced call reads them), so
   * never drawn nor estimated; they count as unchanged unless an exact run measures them.
   */
  zero: Set<string>;
  /** Outputs cached when the run started: exact, never in a ratio. */
  cached: Set<string>;
  /** Size of every output in the population. */
  x: Map<string, number>;
  /** Where size bands start (500 tokens, or its dollar value when sizes are dollars). */
  bandBase: number;
  /** Planned inclusion probability of an uncached output. */
  piOf(key: string): number;
}

/**
 * An output's part in a run: cached (exact, from an earlier run), preview, certain, sample (in
 * the measured prefix of the u/x order), measured (after the first gap: exact, sets no ratio),
 * extrapolated (not measured), zero (size 0, not measured: counts as unchanged) or failed.
 */
export type QuickRole = "cached" | "preview" | "certain" | "sample" | "measured" | "extrapolated" | "zero" | "failed";

export interface QuickFit {
  /** Sampled non-certain outputs the ratios come from. */
  rows: number;
  /** No number: an unmeasured preview, or too few rows with outputs left to estimate. */
  insufficient: boolean;
  /** Uncached outputs of non-zero size neither measured nor failed: each gets ratioFor(key)·x. */
  unmeasured: string[];
  /** R_g for the output's size band (the pooled ratio when its band has none). Undefined when insufficient. */
  ratioFor(key: string): number | undefined;
  /** Standard error of the estimated total saving, in the unit of x (0 when nothing is estimated). */
  se: number;
  /** Sampled outputs (rows) the saver changed (d ≠ 0): with none, se is 0 and says nothing. */
  changed: number;
  /**
   * The standard error for a part of the total (the non-Codex part, say): each row's saving
   * and size in that part, with the same π and ratios.
   */
  seOf(d: (key: string) => number, x: (key: string) => number): number;
  /** Per output: its part in this run (for SAVER_AUDIT_DUMP). */
  role(key: string): QuickRole;
  /** Per output: the inclusion probability used (the recomputed one for a sampled output); undefined for cached ones. */
  pi(key: string): number | undefined;
}

const sha1 = (s: string) => createHash("sha1").update(s).digest();

/** The per-saver salt: a different sample whenever the replay cache has changed. */
export function quickSalt(saver: string, fingerprint: string): string {
  return sha1(`saver-audit/quick/v1\0${saver}\0${fingerprint}`).toString("hex");
}

/** An order-independent fingerprint of the replay cache's keys: their count and the XOR of a 52-bit hash of each. */
export function cacheFingerprint(keys: Iterable<string>): string {
  // Two FNV-1a hashes of 26 bits each (a cache holds ~10^5 keys: a hash each must be cheap).
  let n = 0;
  let hi = 0;
  let lo = 0;
  for (const k of keys) {
    let a = 0x811c9dc5;
    let b = 0x050c5d1f;
    for (let i = 0; i < k.length; i++) {
      const c = k.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ c, 0x01000193);
    }
    hi ^= a >>> 6;
    lo ^= b >>> 6;
    n++;
  }
  return n ? `${n}:${hi.toString(16)}:${lo.toString(16)}` : "";
}

/** A later run reuses the last draw's salt only while the populations share this much of their size mass, both ways. */
export const REUSE_OVERLAP = 0.9;

/**
 * How much two populations (size by key) overlap: the share of the new one's Σx on keys the
 * old one had, and the share of the old one's Σx on keys still present (1 for an empty side).
 */
export function populationOverlap(old: ReadonlyMap<string, number>, now: ReadonlyMap<string, number>): { newOnOld: number; oldOnNew: number } {
  const share = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) => {
    let all = 0;
    let common = 0;
    for (const [k, x] of a) {
      all += x;
      if (b.has(k)) common += x;
    }
    return all > 0 ? common / all : 1;
  };
  return { newOnOld: share(now, old), oldOnNew: share(old, now) };
}

/** u in (0,1) from the salted hash of the key. */
export function unitOf(salt: string, key: string): number {
  return (sha1(`${salt}\0${key}`).readUIntBE(0, 6) + 0.5) / 2 ** 48;
}

/**
 * π_i = min(1, c·x_i) with Σπ = n: the largest are certainties while c·x ≥ 1, and c is
 * re-solved on the rest each time. `items` sorted by size, largest first.
 */
export function ppsProbs(items: Array<{ key: string; x: number }>, n: number): Map<string, number> {
  const pi = new Map<string, number>();
  // rest[i] = Σ x over items[i..], summed from the smallest up
  const rest = new Array<number>(items.length + 1).fill(0);
  for (let i = items.length - 1; i >= 0; i--) rest[i] = rest[i + 1]! + items[i]!.x;
  let left = n;
  let i = 0;
  for (; i < items.length; i++) {
    const tot = rest[i]!;
    if (left <= 0 || tot <= 0) break;
    const c = left / tot;
    if (c * items[i]!.x >= 1) {
      pi.set(items[i]!.key, 1);
      left--;
      continue;
    }
    for (let j = i; j < items.length; j++) pi.set(items[j]!.key, c * items[j]!.x);
    return pi;
  }
  for (; i < items.length; i++) pi.set(items[i]!.key, 0);
  return pi;
}

/** Size band ×2 wide from `base` (500 tokens): 500–1k, 1k–2k, 2k–4k … (smaller ones below). */
export const bandOf = (x: number, base = 500) => Math.floor(Math.log2(Math.max(base / 500, x) / base));

type Row = { x: number; d: number; w: number };

/**
 * Ratios per size band: bands over `sizes` (ascending), merged upward until each holds ≥ MIN
 * rows, the tail joining the last group; R = Σw·d / Σw·x per group, the pooled ratio where a
 * group has none. Undefined everywhere with fewer than MIN rows.
 */
function bandRatios(rows: Row[], sizes: number[], base: number): (size: number) => number | undefined {
  const ratio = (rs: Row[]) => {
    let a = 0;
    let b = 0;
    for (const r of rs) {
      a += r.w * r.d;
      b += r.w * r.x;
    }
    return b > 0 ? a / b : null;
  };
  const pooled = rows.length >= MIN_QUICK_SAMPLE ? ratio(rows) : null;
  if (pooled === null) return () => undefined;
  const band = (x: number) => bandOf(x, base);
  const bands = [...new Set(sizes.map(band))].sort((a, b) => a - b);
  const perBand = new Map<number, Row[]>(bands.map((b) => [b, []]));
  for (const r of rows) perBand.get(band(r.x))?.push(r);
  const merged: number[][] = [];
  let cur: number[] = [];
  let c = 0;
  for (const b of bands) {
    cur.push(b);
    c += perBand.get(b)!.length;
    if (c >= MIN_QUICK_SAMPLE) {
      merged.push(cur);
      cur = [];
      c = 0;
    }
  }
  if (cur.length) {
    if (merged.length) merged[merged.length - 1]!.push(...cur);
    else merged.push(cur);
  }
  const group = new Map<number, number | null>();
  for (const m of merged) {
    const rs = m.flatMap((b) => perBand.get(b)!);
    const r = rs.length >= MIN_QUICK_SAMPLE ? ratio(rs) : null;
    for (const b of m) group.set(b, r);
  }
  return (size) => group.get(band(size)) ?? pooled;
}

/**
 * The quick plan for one saver. `cached`: outputs whose result is cached when the run starts
 * (empty for SAVER_AUDIT_STRICT_SAMPLE=1); `salt`: quickSalt(saver, cacheFingerprint(…)).
 */
export function planQuick(pop: QuickOutput[], budget: number, salt: string, cached: { has(key: string): boolean }, bandBase = 500): QuickPlan {
  const x = new Map(pop.map((o) => [o.key, o.x]));
  const inCache = new Set(pop.filter((o) => cached.has(o.key)).map((o) => o.key));
  const U = pop.filter((o) => !inCache.has(o.key));
  const u = new Map(U.map((o) => [o.key, unitOf(salt, o.key)]));
  const byU = (a: QuickOutput, b: QuickOutput) => u.get(a.key)! - u.get(b.key)! || (a.key < b.key ? -1 : 1);
  const bySize = (a: QuickOutput, b: QuickOutput) => b.x - a.x || (a.key < b.key ? -1 : 1);
  const zero = U.filter((o) => !(o.x > 0));
  const pv = U.filter((o) => o.preview && o.x > 0).sort(byU);
  const taken = pv.slice(0, Math.floor(budget / 2));
  const other = U.filter((o) => !o.preview && o.x > 0);
  let n = budget - taken.length;
  let pi = new Map<string, number>();
  let certain: QuickOutput[] = [];
  let ranked: QuickOutput[];
  const sorted = [...other].sort(bySize);
  // The budget grows (a small overshoot) so that certainties never leave fewer than MIN
  // sampled outputs for the ratio, and fewer than MIN would never be left unsampled.
  for (;;) {
    if (other.length - n < MIN_QUICK_SAMPLE) break;
    pi = ppsProbs(sorted, n);
    certain = sorted.filter((o) => pi.get(o.key)! >= 1);
    if (n - certain.length >= MIN_QUICK_SAMPLE) break;
    n += MIN_QUICK_SAMPLE;
  }
  if (other.length - n < MIN_QUICK_SAMPLE) {
    // Everything fits: all of it is replayed, and the result is exact.
    n = Math.max(n, other.length);
    certain = sorted;
    ranked = [];
    pi = new Map(other.map((o) => [o.key, 1]));
  } else {
    // u/x: sequential Poisson order (∝ u/π).
    const q = (o: QuickOutput) => u.get(o.key)! / o.x;
    ranked = other.filter((o) => pi.get(o.key)! < 1).sort((a, b) => q(a) - q(b) || byU(a, b));
  }
  const keys = (os: QuickOutput[]) => os.map((o) => o.key);
  const order = [...keys(taken), ...keys(certain), ...keys(ranked), ...keys(pv.slice(taken.length)), ...keys(zero)];
  const quick = taken.length + certain.length + Math.max(0, Math.min(ranked.length, n - certain.length));
  const pvTaken = new Set(keys(taken));
  return {
    order,
    quick,
    certain: new Set(keys(certain)),
    ranked: keys(ranked),
    previews: new Set(keys(pv)),
    allPreviews: new Set(keys(pop.filter((o) => o.preview))),
    zero: new Set(keys(zero)),
    cached: inCache,
    x,
    bandBase,
    piOf: (k) => (inCache.has(k) ? 1 : pvTaken.has(k) ? 1 : (pi.get(k) ?? 0)),
  };
}

/**
 * Fits the estimate from what was measured. `measured`: each uncached output with a result in
 * this run and its saving d (summed over its occurrences); `failed`: outputs whose replay
 * failed (counted as unchanged: never measured, never estimated, not in X).
 *
 * The sample is the certainties plus the longest prefix of the u/x order in which every output
 * was measured or failed (a clock stop or out-of-order completion leaves a prefix). With k
 * outputs measured there, π_i = min(1, k·x_i / X), X = Σx over the non-certain outputs that
 * did not fail. An output measured after the first gap is exact but sets no ratio.
 */
export function fitQuick(plan: QuickPlan, measured: ReadonlyMap<string, number>, failed: { has(key: string): boolean }): QuickFit {
  const x = (k: string) => plan.x.get(k)!;
  // The measured prefix of the u/x order.
  const prefix: string[] = [];
  for (const k of plan.ranked) {
    if (failed.has(k)) continue;
    if (!measured.has(k)) break;
    prefix.push(k);
  }
  let X = 0;
  for (const k of plan.ranked) if (!failed.has(k)) X += x(k);
  const piUsed = new Map<string, number>();
  const rows: Array<{ key: string; x: number; d: number; p: number; w: number }> = [];
  for (const k of prefix) {
    const p = X > 0 ? Math.min(1, (prefix.length * x(k)) / X) : 0;
    piUsed.set(k, p);
    if (p > 0 && p < 1) rows.push({ key: k, x: x(k), d: measured.get(k)!, p, w: (1 - p) / p });
  }
  const inPrefix = new Set(prefix);
  const unmeasured: string[] = [];
  let previewLeft = false;
  let otherLeft = false;
  for (const k of plan.order) {
    if (measured.has(k) || failed.has(k) || plan.zero.has(k)) continue;
    unmeasured.push(k);
    if (plan.previews.has(k)) previewLeft = true;
    else otherLeft = true;
  }
  // Size bands over every non-preview uncached output, merged upward until each holds ≥ MIN rows.
  const ratioOfSize = bandRatios(rows, plan.order.filter((k) => !plan.previews.has(k) && !plan.zero.has(k)).map(x), plan.bandBase);
  const pooled = ratioOfSize(0) ?? null;
  const insufficient = previewLeft || (otherLeft && pooled === null);
  let v = 0;
  if (!insufficient && unmeasured.length) {
    for (const r of rows) {
      const e = r.d - ratioOfSize(r.x)! * r.x;
      v += ((1 - r.p) / (r.p * r.p)) * e * e;
    }
  }
  return {
    rows: rows.length,
    insufficient,
    unmeasured,
    ratioFor: (k) => (insufficient ? undefined : ratioOfSize(x(k))),
    se: Math.sqrt(v),
    changed: rows.filter((r) => r.d !== 0).length,
    seOf(dOf, xOf) {
      if (insufficient || !unmeasured.length) return 0;
      let w = 0;
      for (const r of rows) {
        const e = dOf(r.key) - ratioOfSize(r.x)! * xOf(r.key);
        w += ((1 - r.p) / (r.p * r.p)) * e * e;
      }
      return Math.sqrt(w);
    },
    role(k) {
      if (plan.cached.has(k)) return "cached";
      if (failed.has(k)) return "failed";
      if (!measured.has(k)) return plan.zero.has(k) ? "zero" : "extrapolated";
      if (plan.previews.has(k)) return "preview";
      if (plan.certain.has(k)) return "certain";
      // In the sample; one whose recomputed π is 1 carries no weight (w = 0).
      if (inPrefix.has(k)) return "sample";
      return "measured"; // after the first gap: exact, but sets no ratio
    },
    pi: (k) => (plan.cached.has(k) ? undefined : (piUsed.get(k) ?? plan.piOf(k))),
  };
}

/** Outputs are estimated from the plain ratio of the measured ones only up to this share of the saver's size. */
export const MAX_FROM_CACHE = 0.25;

export interface CacheFit {
  /** The share of the saver's size (Σx, failed outputs left out) that is estimated. */
  share: number;
  /** No number: an unmeasured preview, too few known outputs, or more than MAX_FROM_CACHE to estimate. */
  insufficient: boolean;
  /** Outputs neither known nor failed: each gets ratioFor(key)·x. */
  unmeasured: string[];
  ratioFor(key: string): number | undefined;
}

/**
 * When there is no sample to estimate from (a cache-only saver: headroom, or the caveman
 * engine with too many new outputs; or a sample too thin because the clock stopped among
 * the certainties), outputs not measured get the measured outputs' ratio Σd/Σx per size
 * band, when they are at most MAX_FROM_CACHE of the saver's size. The measured outputs are
 * not a probability sample (they may be an earlier sub-period, or the largest), so there is
 * no standard error; any bias is confined to that share, which the report states.
 * `known`: saving d of each cached or replayed output.
 */
export function fitFromMeasured(plan: QuickPlan, known: ReadonlyMap<string, number>, failed: { has(key: string): boolean }): CacheFit {
  const all = [...plan.x.keys()].filter((k) => !failed.has(k));
  const unmeasured = plan.order.filter((k) => !known.has(k) && !failed.has(k) && !plan.zero.has(k));
  const sum = (ks: string[]) => ks.reduce((a, k) => a + plan.x.get(k)!, 0);
  const total = sum(all);
  const share = unmeasured.length ? (total > 0 ? sum(unmeasured) / total : 1) : 0;
  const rows: Row[] = [];
  for (const [k, d] of known) if (!plan.allPreviews.has(k) && plan.x.has(k) && plan.x.get(k)! > 0) rows.push({ x: plan.x.get(k)!, d, w: 1 });
  const ratioOfSize = bandRatios(rows, all.filter((k) => !plan.allPreviews.has(k) && plan.x.get(k)! > 0).map((k) => plan.x.get(k)!), plan.bandBase);
  const insufficient = unmeasured.length > 0 && (share > MAX_FROM_CACHE || unmeasured.some((k) => plan.allPreviews.has(k)) || ratioOfSize(0) === undefined);
  return { share, insufficient, unmeasured, ratioFor: (k) => (insufficient ? undefined : ratioOfSize(plan.x.get(k)!)) };
}
