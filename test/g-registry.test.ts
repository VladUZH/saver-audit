// A built-in manifest only loads once registry.ts imports it (CONTRIBUTING's checklist).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SAVERS } from "../src/savers/registry.ts";

const DIR = fileURLToPath(new URL("../src/savers/builtin/", import.meta.url));

test("every manifest in src/savers/builtin/ is a registered saver", () => {
  const ids = new Set(SAVERS.map((s) => s.id));
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    const id = JSON.parse(readFileSync(`${DIR}${file}`, "utf8")).id;
    assert.equal(file, `${id}.json`, `src/savers/builtin/${file}: the file name should be its id`);
    assert.ok(ids.has(id), `src/savers/builtin/${file} is not loaded: import it in src/savers/registry.ts and add it to BUILTIN`);
  }
});
