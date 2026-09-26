// Price table: USD per 1M tokens. Built from models.dev (MIT), with LiteLLM (MIT)
// filling in retired models only. Pure functions; no I/O here.

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

// Retired models seen in real Codex logs that models.dev no longer lists.
const RETIRED = ["gpt-5-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5.1-codex-max", "gpt-5.2-codex"];

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

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
  for (const id of RETIRED) {
    const e = litellm?.[id];
    if (models[id] || !e || typeof e.input_cost_per_token !== "number") continue;
    const perM = (v: unknown) => (typeof v === "number" ? round(v * 1e6) : 0);
    models[id] = {
      input: perM(e.input_cost_per_token),
      output: perM(e.output_cost_per_token),
      cacheRead: perM(e.cache_read_input_token_cost),
      cacheWrite: 0,
      cacheWrite1h: 0,
    };
  }
  return {
    date,
    sources: ["https://models.dev/api.json (MIT)", "LiteLLM model_prices_and_context_window.json (MIT), retired models only"],
    models: Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b))),
    aliases: ALIASES,
  };
}

/** Resolves a logged model name to a priced model id, or undefined. */
export function resolveModel(table: PriceTable, model: string, timestamp?: string): string | undefined {
  let m = model.replace(/\[1m\]$/i, "").replace(/^(openai|anthropic)\//, "");
  // Own keys only: a logged name like "constructor" must not hit Object.prototype.
  const alias = Object.hasOwn(table.aliases, m) ? table.aliases[m] : undefined;
  if (Array.isArray(alias) && alias.length) {
    const day = (timestamp ?? "").slice(0, 10);
    m = (alias.find((a) => !a.until || (day && day < a.until)) ?? alias[alias.length - 1]!).model;
  }
  if (Object.hasOwn(table.models, m)) return m;
  const undated = m.replace(/-\d{8}$/, "");
  if (Object.hasOwn(table.models, undated)) return undated;
  return undefined;
}

/** Rates for one call, choosing a context tier by prompt size. */
export function ratesFor(price: ModelPrice, promptTokens: number): Rates {
  let r: Rates = price;
  for (const t of price.tiers ?? []) if (promptTokens > t.above) r = t;
  return r;
}
