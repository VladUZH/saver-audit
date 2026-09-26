import { readFileSync } from "node:fs";
import { join } from "node:path";
import bundled from "../../data/prices.json" with { type: "json" };
import { cacheHome } from "../savers/cache.ts";
import type { ModelPrice, PriceTable } from "./table.ts";

/** The snapshot shipped with this version. */
export const BUNDLED = bundled as PriceTable;

/** Where --update-prices saves a fresh table. */
export function userPricesPath(): string {
  return join(cacheHome(), "saver-audit", "prices.json");
}

/** The bundled snapshot, overlaid with a newer table saved by --update-prices. */
export function loadPrices(path = userPricesPath()): PriceTable {
  const base = BUNDLED;
  try {
    const user = JSON.parse(readFileSync(path, "utf8")) as PriceTable;
    if (user?.models && typeof user.models === "object" && typeof user.date === "string" && user.date > base.date) return overlay(base, user);
  } catch {
    // no saved update: use the bundled snapshot
  }
  return base;
}

/**
 * Fresh prices win, but a model the update lacks (dropped upstream once retired, or
 * missing after a failed LiteLLM fetch) keeps its bundled price. So does a Claude
 * model's >200k-token tier: it comes from LiteLLM, not from models.dev with the base
 * rates, so a saved Claude entry without one (LiteLLM failed, or a version that read no
 * Claude tiers saved it) keeps the bundled tier. OpenAI tiers come from models.dev
 * with the base rates, so a saved OpenAI entry is taken as it is. Aliases are code, so
 * they always come from this version.
 */
export function overlay(base: PriceTable, user: PriceTable): PriceTable {
  const kept = Object.keys(base.models).filter((id) => !Object.hasOwn(user.models, id)).length;
  const models: Record<string, ModelPrice> = { ...base.models, ...user.models };
  let tiers = 0;
  for (const [id, b] of Object.entries(base.models)) {
    const u = Object.hasOwn(user.models, id) ? user.models[id] : undefined;
    if (!id.startsWith("claude-") || !b.tiers || !u || typeof u !== "object" || u.tiers) continue;
    models[id] = { ...u, tiers: b.tiers };
    tiers++;
  }
  const sources = Array.isArray(user.sources) ? [...user.sources] : [];
  if (kept) sources.push(`bundled snapshot of ${base.date} for ${kept} models the update lacks`);
  if (tiers) sources.push(`bundled snapshot of ${base.date} for the >200k-token rates the update lacks on ${tiers} Claude models`);
  return { date: user.date, sources, models, aliases: base.aliases };
}
