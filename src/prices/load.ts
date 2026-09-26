import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import bundled from "../../data/prices.json" with { type: "json" };
import type { PriceTable } from "./table.ts";

/** The snapshot shipped with this version. */
export const BUNDLED = bundled as PriceTable;

/** $XDG_CACHE_HOME, or ~/.cache when it is unset, empty or relative (XDG spec). */
export function cacheHome(): string {
  const x = process.env.XDG_CACHE_HOME;
  return x && isAbsolute(x) ? x : join(homedir(), ".cache");
}

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
 * missing after a failed LiteLLM fetch) keeps its bundled price. Aliases are code,
 * so they always come from this version.
 */
export function overlay(base: PriceTable, user: PriceTable): PriceTable {
  const kept = Object.keys(base.models).filter((id) => !Object.hasOwn(user.models, id)).length;
  const sources = Array.isArray(user.sources) ? user.sources : [];
  return {
    date: user.date,
    sources: kept ? [...sources, `bundled snapshot of ${base.date} for ${kept} models the update lacks`] : sources,
    models: { ...base.models, ...user.models },
    aliases: base.aliases,
  };
}
