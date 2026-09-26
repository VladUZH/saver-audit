// Offline token counting with o200k_base as a proxy, calibrated per model against
// the usage recorded in the user's own logs (tech-notes.md §4).
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

const NO_SPECIAL = { disallowedSpecial: new Set<string>() };

const SLICE = 400;
const LONG_RUN = /\S{400,}/g;
const CACHE_MIN = 1024;
const CACHE_MAX = 4096;
const cache = new Map<string, number>();

/**
 * o200k_base token count. Log text may contain strings like <|endoftext|>: count them
 * as text. BPE is quadratic in the length of one pre-tokenized piece, so runs of 400+
 * non-space characters (base64, minified code) are counted in 400-char slices; that
 * adds at most one token per slice and keeps counting linear.
 */
export function countProxy(text: string): number {
  if (!text) return 0;
  const cached = text.length >= CACHE_MIN ? cache.get(text) : undefined;
  if (cached !== undefined) return cached;
  let n = 0;
  let rest = text;
  if (text.length >= SLICE) {
    rest = text.replace(LONG_RUN, (run) => {
      for (let i = 0; i < run.length; i += SLICE) n += countTokens(run.slice(i, i + SLICE), NO_SPECIAL);
      return " ";
    });
  }
  n += countTokens(rest, NO_SPECIAL);
  if (text.length >= CACHE_MIN) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(text, n);
  }
  return n;
}

/** One observation: tokens appended between two calls (A, from usage) vs proxy count (L). */
export interface CalibrationPair {
  model: string;
  appended: number;
  proxy: number;
}

export interface Calibration {
  model: string;
  /** What k was fitted on: the model itself, or its tokenizer family when it had too few pairs. */
  fittedOn: string;
  /** Multiply o200k counts by k to estimate the model's tokens. */
  k: number;
  /** Fitted per-step tokens not in the logs (Claude). */
  c: number;
  n: number;
  p25: number;
  p75: number;
  basis: "model" | "family" | "tokenizer" | "none";
  quality: "good" | "fair" | "poor";
}

export const MIN_PROXY_TOKENS = 200;
const MIN_PAIRS = 30;

/**
 * Tokenizer family: Claude has two generations (≤4.6 and 4.7+), OpenAI models share
 * o200k. An unrecognised Claude id has no family and is never pooled.
 */
export function tokenizerFamily(model: string): string | undefined {
  if (!model.startsWith("claude")) return "openai (o200k)";
  if (/fable|mythos/.test(model)) return "claude 4.7+ tokenizer";
  // Legacy naming: claude-3-7-sonnet-…, claude-3-5-haiku-…, claude-3-opus-….
  if (/^claude-3(?:-\d)?-(?:opus|sonnet|haiku)(?:\D|$)/.test(model)) return "claude ≤4.6 tokenizer";
  const m = /claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:\D|$)/.exec(model);
  if (!m) return undefined;
  const major = Number(m[1]);
  const minor = m[2] ? Number(m[2]) : 0;
  if (/haiku/.test(model) && major === 4) return "claude ≤4.6 tokenizer";
  return major > 4 || (major === 4 && minor >= 7) ? "claude 4.7+ tokenizer" : "claude ≤4.6 tokenizer";
}

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

const MAX_FIT_POINTS = 1500;

/**
 * Theil–Sen fit of A = k·L + c. The intercept absorbs context Claude Code adds each
 * step without logging it (it made small steps look like k > 2 with a plain ratio).
 * Deterministic: an evenly spaced subsample keeps the O(n²) slope set bounded.
 */
export function theilSen(points: Array<[number, number]>): { k: number; c: number } {
  const step = Math.max(1, Math.ceil(points.length / MAX_FIT_POINTS));
  const pts = points.filter((_, i) => i % step === 0);
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j]![0] - pts[i]![0];
      if (Math.abs(dx) >= 50) slopes.push((pts[j]![1] - pts[i]![1]) / dx);
    }
  }
  if (!slopes.length) return { k: 1, c: 0 };
  slopes.sort((a, b) => a - b);
  const k = quantile(slopes, 0.5);
  const resid = pts.map(([x, y]) => y - k * x).sort((a, b) => a - b);
  return { k, c: quantile(resid, 0.5) };
}

function fit(label: string, points: Array<[number, number]>, basis: Calibration["basis"]): Calibration {
  const { k, c } = theilSen(points);
  const implied = points.map(([x, y]) => (y - c) / x).sort((a, b) => a - b);
  const p25 = quantile(implied, 0.25);
  const p75 = quantile(implied, 0.75);
  const spread = (p75 - p25) / k;
  const n = points.length;
  const quality = k > 0 && n >= MIN_PAIRS && spread <= 0.5 ? "good" : k > 0 && n >= 10 && spread <= 1 ? "fair" : "poor";
  return { model: label, fittedOn: label, k: k > 0 ? k : 1, c, n, p25, p75, basis, quality };
}

/**
 * Claude: fit per model, falling back to the tokenizer family, then k = 1 flagged as
 * uncalibrated. OpenAI: k = 1, because o200k_base is the gpt-5.x tokenizer (tiktoken's
 * model map); per-pair deltas are not usable there, since Codex sometimes writes a
 * token_count after the next tool output (tech-notes §8.6).
 */
export function calibrate(pairs: CalibrationPair[], models: string[]): Map<string, Calibration> {
  const byModel = new Map<string, Array<[number, number]>>();
  const byFamily = new Map<string, Array<[number, number]>>();
  for (const p of pairs) {
    if (p.proxy < MIN_PROXY_TOKENS || p.appended <= 0 || !p.model.startsWith("claude")) continue;
    const pt: [number, number] = [p.proxy, p.appended];
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model)!.push(pt);
    const fam = tokenizerFamily(p.model);
    if (!fam) continue;
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(pt);
  }
  const out = new Map<string, Calibration>();
  for (const model of models) {
    if (!model.startsWith("claude")) {
      out.set(model, { model, fittedOn: "o200k_base", k: 1, c: 0, n: 0, p25: 1, p75: 1, basis: "tokenizer", quality: "good" });
      continue;
    }
    const own = byModel.get(model) ?? [];
    const famName = tokenizerFamily(model);
    const fam = (famName && byFamily.get(famName)) || [];
    if (own.length >= MIN_PAIRS) out.set(model, fit(model, own, "model"));
    else if (famName && fam.length >= 10) out.set(model, { ...fit(famName, fam, "family"), model });
    else out.set(model, { model, fittedOn: "none", k: 1, c: 0, n: own.length, p25: 1, p75: 1, basis: "none", quality: "poor" });
  }
  return out;
}
