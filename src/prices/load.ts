import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import bundled from "../../data/prices.json" with { type: "json" };
import type { PriceTable } from "./table.ts";

/** Where --update-prices saves a fresh table. */
export function userPricesPath(): string {
  const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(cache, "saver-audit", "prices.json");
}

/** The bundled snapshot, or a newer table saved by --update-prices. */
export function loadPrices(): PriceTable {
  const base = bundled as PriceTable;
  try {
    const user = JSON.parse(readFileSync(userPricesPath(), "utf8")) as PriceTable;
    if (user?.models && typeof user.date === "string" && user.date > base.date) return user;
  } catch {
    // no saved update: use the bundled snapshot
  }
  return base;
}
