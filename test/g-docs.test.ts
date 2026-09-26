// Docs that restate what the code does, checked against the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAVERS } from "../src/savers/registry.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");

test("README's version rule and older-copy offer name only savers whose version saver-audit can read", () => {
  const readme = read("README.md");
  const rule = /For ([^.:]+?) it takes the first copy that is not older/.exec(readme)?.[1];
  const offer = /\*\*Older copies:\*\* if the ([^.]+?) found is older/.exec(readme)?.[1];
  assert.ok(rule && offer, "README: which copy is used, and which older copies the installer offers again");
  const named = (text: string) => SAVERS.filter((s) => s.manifest?.method === "replayed" && text.includes(s.id === "caveman-engine" ? "caveman engine" : s.id));
  for (const text of [rule, offer]) {
    assert.ok(named(text).length, text);
    for (const s of named(text)) assert.ok(s.manifest?.versionArgs, `README checks the version of ${s.id}, but its manifest has no versionArgs: "${text}"`);
  }
});
