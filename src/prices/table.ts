// Price table: USD per 1M tokens. Built from models.dev (MIT), with LiteLLM (MIT)
// filling in models models.dev lacks. Pure functions; no I/O here.

export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache write. */
  cacheWrite: number;
  /** 1-hour cache write (models.dev lacks it; derived as 2x input for Claude). */
  cacheWrite1h: number;
}

export interface ModelPrice extends Rates {
  /** Higher rates once a call's prompt exceeds `above` tokens. */
  tiers?: Array<Rates & { above: number }>;
}

export interface Alias {
  /** Use `model` for calls before this ISO date (exclusive); last entry has no `until`. */
  until?: string;
  model: string;
}

export interface PriceTable {
  date: string;
  sources: string[];
  models: Record<string, ModelPrice>;
  aliases: Record<string, Alias[]>;
}

// Models with no public price, mapped the way ccusage maps them (tech-notes §2.3).
export const ALIASES: Record<string, Alias[]> = {
  "codex-auto-review": [{ until: "2026-07-29", model: "gpt-5.4" }, { model: "gpt-5.6-luna" }],
};

// Fast-mode price multiplier (Claude usage.speed "fast"), from LiteLLM's
// provider_specific_entry.fast: Opus 4.6 and 4.7 from its 2026-05-29 file (commit
// bae04591; fast mode on them was retired since), the rest from 2026-09-25, which
// matches tech-notes §5.1 ($8/$40 on Opus 5.5, $10/$50 on Opus 5 and 4.8).
export const FAST_MODE: Record<string, number> = {
  "claude-opus-4-6": 6,
  "claude-opus-4-7": 6,
  "claude-opus-4-8": 2,
  "claude-opus-5": 2,
  "claude-opus-5-5": 2,
};

/** Fast-mode multiplier for a logged Claude model, or undefined when none is published. */
export function fastMultiplier(model: string): number | undefined {
  const m = model.replace(/\[1m\]$/i, "").replace(/^anthropic\//, "").replace(/-\d{8}$/, "");
  return Object.hasOwn(FAST_MODE, m) ? FAST_MODE[m] : undefined;
}

// Models seen in logs that models.dev does not list, priced from LiteLLM: retired Codex
// and Claude models (the Claude ones only in an archived LiteLLM file, see
// scripts/snapshot-prices.ts) and the Project Glasswing Mythos models.
const FROM_LITELLM = [
  "gpt-5-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5.1-codex-max", "gpt-5.2-codex",
  "claude-opus-4-20250514", "claude-opus-4-1", "claude-opus-4-1-20250805", "claude-sonnet-4-20250514",
  "claude-mythos-5", "claude-mythos-5-1",
];

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * LiteLLM per-token costs as per-1M rates, for the fields ending in `suffix` (a context
 * tier such as "_above_200k_tokens"); missing Claude cache writes derived as in rates().
 */
function litellmRates(e: any, claude: boolean, suffix = ""): Rates {
  const perM = (field: string) => (typeof e[field + suffix] === "number" ? round(e[field + suffix] * 1e6) : undefined);
  const input = perM("input_cost_per_token") ?? 0;
  const cacheWrite = perM("cache_creation_input_token_cost") ?? (claude ? round(input * 1.25) : 0);
  return {
    input,
    output: perM("output_cost_per_token") ?? 0,
    cacheRead: perM("cache_read_input_token_cost") ?? 0,
    cacheWrite,
    cacheWrite1h: perM("cache_creation_input_token_cost_above_1hr") ?? (claude ? round(input * 2) : cacheWrite),
  };
}

const ABOVE_200K = "_above_200k_tokens";

function rates(c: any, claude: boolean): Rates {
  const input = Number(c.input ?? 0);
  const cacheWrite = c.cache_write != null ? Number(c.cache_write) : claude ? input * 1.25 : 0;
  return {
    input,
    output: Number(c.output ?? 0),
    cacheRead: Number(c.cache_read ?? 0),
    cacheWrite: round(cacheWrite),
    cacheWrite1h: claude ? round(input * 2) : round(cacheWrite),
  };
}

export function buildPriceTable(modelsDev: any, litellm: any, date: string): PriceTable {
  const models: Record<string, ModelPrice> = {};
  for (const provider of ["anthropic", "openai"]) {
    const list = modelsDev?.[provider]?.models ?? {};
    for (const [id, m] of Object.entries<any>(list)) {
      if (!m?.cost || typeof m.cost.input !== "number") continue;
      const claude = provider === "anthropic";
      const price: ModelPrice = rates(m.cost, claude);
      if (Array.isArray(m.cost.tiers)) {
        const tiers = m.cost.tiers
          .filter((t: any) => t?.tier?.type === "context" && typeof t.tier.size === "number")
          .map((t: any) => ({ above: t.tier.size, ...rates(t, claude) }));
        if (tiers.length) price.tiers = tiers;
      }
      models[id] = price;
    }
  }
  let fromLitellm = 0;
  for (const id of FROM_LITELLM) {
    const e = litellm?.[id];
    if (models[id] || !e || typeof e.input_cost_per_token !== "number") continue;
    models[id] = litellmRates(e, id.startsWith("claude-"));
    fromLitellm++;
  }
  // models.dev lists no long-context tier for Claude. LiteLLM keeps the >200k premium
  // for the models that still have one (Sonnet 4.5, Sonnet 4).
  for (const [id, price] of Object.entries(models)) {
    const e = litellm?.[id];
    if (!id.startsWith("claude-") || price.tiers || !e) continue;
    if (["input_cost_per_token", "output_cost_per_token", "cache_read_input_token_cost"].some((f) => typeof e[f + ABOVE_200K] !== "number")) continue;
    price.tiers = [{ above: 200_000, ...litellmRates(e, true, ABOVE_200K) }];
    fromLitellm++;
  }
  const sources = ["https://models.dev/api.json (MIT)"];
  if (fromLitellm) sources.push("LiteLLM model_prices_and_context_window.json (MIT), for models models.dev lacks and Claude >200k-token rates");
  return {
    date,
    sources,
    models: Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b))),
    aliases: ALIASES,
  };
}

// Dated snapshot of a model: Anthropic -YYYYMMDD, OpenAI -YYYY-MM-DD.
const DATED = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** A logged model name without its 1M-context marker and provider prefix. */
function bareModel(model: string): string {
  return model.replace(/\[1m\]$/i, "").replace(/^(openai|anthropic)\//, "");
}

/** Priced through an alias (the model has no public price), not as itself or its dated snapshot's base model. */
export function viaAlias(model: string, pricedAs: string): boolean {
  const m = bareModel(model);
  return pricedAs !== m && pricedAs !== m.replace(DATED, "");
}

/** Resolves a logged model name to a priced model id, or undefined. */
export function resolveModel(table: PriceTable, model: string, timestamp?: string): string | undefined {
  let m = bareModel(model);
  // Own keys only: a logged name like "constructor" must not hit Object.prototype.
  const alias = Object.hasOwn(table.aliases, m) ? table.aliases[m] : undefined;
  if (Array.isArray(alias) && alias.length) {
    const day = (timestamp ?? "").slice(0, 10);
    m = (alias.find((a) => !a.until || (day && day < a.until)) ?? alias[alias.length - 1]!).model;
  }
  if (Object.hasOwn(table.models, m)) return m;
  // Dated snapshot of a priced model.
  const undated = m.replace(DATED, "");
  if (Object.hasOwn(table.models, undated)) return undated;
  return undefined;
}

/** Rates for one call, choosing a context tier by prompt size. */
export function ratesFor(price: ModelPrice, promptTokens: number): Rates {
  let r: Rates = price;
  for (const t of price.tiers ?? []) if (promptTokens > t.above) r = t;
  return r;
}
