// Docs that restate what the code does, checked against the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAVERS } from "../src/savers/registry.ts";
import { periodOf } from "../src/period.ts";

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

test("STATUS's re-run of the launch window covers the window the launch numbers came from", (t) => {
  const status = read("STATUS.md");
  const i = status.indexOf("To repeat the same window");
  if (i < 0) return t.skip("STATUS asks for no re-run of the launch window");
  const windowOf = (text: string) => {
    const m = /--since (\S+) --until ([^\s`]+)/.exec(text);
    assert.ok(m, text.slice(0, 200));
    return periodOf({ since: m[1], until: m[2] }, 0);
  };
  // The fact sheet records the command every launch number came from.
  assert.deepEqual(windowOf(status.slice(i)), windowOf(read("docs/launch/show-hn-fact-sheet.md")));
});
