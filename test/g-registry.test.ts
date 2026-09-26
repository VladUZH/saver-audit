// A built-in manifest only loads once registry.ts imports it (CONTRIBUTING's checklist).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SAVERS, saversHelp } from "../src/savers/registry.ts";
import type { Method } from "../src/savers/types.ts";

const DIR = fileURLToPath(new URL("../src/savers/builtin/", import.meta.url));

test("every manifest in src/savers/builtin/ is a registered saver", () => {
  const ids = new Set(SAVERS.map((s) => s.id));
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    const id = JSON.parse(readFileSync(`${DIR}${file}`, "utf8")).id;
    assert.equal(file, `${id}.json`, `src/savers/builtin/${file}: the file name should be its id`);
    assert.ok(ids.has(id), `src/savers/builtin/${file} is not loaded: import it in src/savers/registry.ts and add it to BUILTIN`);
  }
});

test("--help's saver list comes from the registry: a newly registered saver is named with its method", () => {
  const add = (id: string, method: Method) => ({ ...SAVERS[0]!, id, method });
  const help = saversHelp([...SAVERS, add("my-saver", "upper-bound")]).replace(/\s+/g, " ");
  assert.match(help, /\bmy-saver\b[^()]*\(upper bounds?\)/);
  const text = saversHelp(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((x, i) => add(`${x}-long-saver-name`, (["replayed", "upper-bound", "replayed", "modeled"] as const)[i % 4]!)));
  assert.equal(
    text.replace(/\s+/g, " "),
    "Savers: a-long-saver-name, c-long-saver-name, e-long-saver-name, g-long-saver-name, i-long-saver-name (replayed on your installed copies), d-long-saver-name, h-long-saver-name (modeled), b-long-saver-name, f-long-saver-name, j-long-saver-name (upper bounds).",
  );
  for (const line of text.split("\n")) assert.ok(line.length <= 84, line);
  assert.equal(saversHelp([add("one", "replayed"), add("two", "upper-bound")]), "Savers: one (replayed on your installed copy), two (upper bound).");
});
