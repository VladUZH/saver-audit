// Dev-time: build data/prices.json from downloaded models.dev and LiteLLM JSON files.
//   curl -s https://models.dev/api.json -o models.json
//   curl -s https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json -o litellm.json
//   node scripts/snapshot-prices.ts models.json litellm.json 2026-09-25
import { readFileSync, writeFileSync } from "node:fs";
import { buildPriceTable } from "../src/prices/table.ts";

const [modelsDev, litellm, date] = process.argv.slice(2);
if (!modelsDev || !litellm || !date) throw new Error("usage: snapshot-prices.ts <models.json> <litellm.json> <YYYY-MM-DD>");
const table = buildPriceTable(JSON.parse(readFileSync(modelsDev, "utf8")), JSON.parse(readFileSync(litellm, "utf8")), date);
writeFileSync("data/prices.json", JSON.stringify(table, null, 1) + "\n");
console.log(`data/prices.json: ${Object.keys(table.models).length} models, dated ${date}`);
