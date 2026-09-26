// Dev-time: build data/prices.json from downloaded models.dev and LiteLLM JSON files.
//   curl -s https://models.dev/api.json -o models.json
//   curl -s https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json -o litellm.json
//   node scripts/snapshot-prices.ts models.json litellm.json 2026-09-25 [archived-litellm.json ...]
// LiteLLM drops models some time after they retire. Older copies of its file, passed
// after the date, fill in ids the current one lacks (the current file wins). The
// 2026-09-25 snapshot takes retired Claude models (Opus 4 / 4.1, Sonnet 4) from:
//   curl -s https://raw.githubusercontent.com/BerriAI/litellm/bae04591b2861eedb26c55ea007d11f9f49deaa7/model_prices_and_context_window.json -o litellm-2026-05-29.json
import { readFileSync, writeFileSync } from "node:fs";
import { buildPriceTable } from "../src/prices/table.ts";

const [modelsDev, litellm, date, ...archives] = process.argv.slice(2);
if (!modelsDev || !litellm || !date) throw new Error("usage: snapshot-prices.ts <models.json> <litellm.json> <YYYY-MM-DD> [archived-litellm.json ...]");
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const table = buildPriceTable(read(modelsDev), Object.assign({}, ...archives.map(read), read(litellm)), date);
writeFileSync("data/prices.json", JSON.stringify(table, null, 1) + "\n");
console.log(`data/prices.json: ${Object.keys(table.models).length} models, dated ${date}`);
