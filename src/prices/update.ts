// The ONLY module allowed to use the network, and only when the user passes
// --update-prices. test/offline.test.ts enforces this.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildPriceTable, type PriceTable } from "./table.ts";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export async function updatePrices(target: string, log: (s: string) => void): Promise<PriceTable> {
  log(`--update-prices: fetching ${MODELS_DEV_URL}`);
  const modelsDev = await getJson(MODELS_DEV_URL);
  log(`--update-prices: fetching ${LITELLM_URL} (retired models only)`);
  const litellm = await getJson(LITELLM_URL).catch(() => ({}));
  const table = buildPriceTable(modelsDev, litellm, new Date().toISOString().slice(0, 10));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(table, null, 1) + "\n");
  log(`--update-prices: saved ${Object.keys(table.models).length} model prices to ${target}`);
  return table;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
