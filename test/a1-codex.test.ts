// Content re-sent with every request survives compaction in the context tracker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextTracker } from "../src/accounting/buckets.ts";
import { countProxy } from "../src/accounting/tokens.ts";
import { emptyUsage, type Turn, type Usage } from "../src/sources/types.ts";

const user = (text: string, userKind: Turn["userKind"], resent?: boolean): Turn => ({ index: 0, role: "user", timeline: "main", blocks: [{ kind: "text", text }], userKind, ...(resent ? { resent } : {}) });
const call = (key: string, usage: Partial<Usage>): Turn => ({
  index: 0,
  role: "assistant",
  timeline: "main",
  blocks: [],
  call: { key, model: "gpt-5.6-terra", usage: { ...emptyUsage(), ...usage }, multiplier: 1, billable: true },
});

test("base instructions sent with every request stay attributed after compaction", () => {
  const base = "You are a coding agent working in the user's repository. ".repeat(80);
  const developer = "Sandbox: workspace-write. Approvals: on-request. ".repeat(20);
  const tr = new ContextTracker(0, "codex");
  tr.turn(user(base, "system", true));
  tr.turn(user(developer, "system"));
  tr.turn(user("fix the build", "prompt"));
  tr.turn(call("c1", { input: 1500, output: 100 }));
  tr.compact("main");
  tr.turn(user("summary of the work so far", "compaction-summary"));
  tr.turn(call("c2", { input: 1300, cacheRead: 1000, output: 50 }));
  tr.compact("main");
  tr.turn(call("c3", { input: 100, cacheRead: 1000, output: 10 }));
  const [first, second, third] = tr.records;
  assert.equal(first!.newRaw.system, countProxy(base) + countProxy(developer));
  assert.deepEqual(second!.oldRaw, { system: countProxy(base) }, "the developer message was replaced by the compaction");
  assert.deepEqual(third!.oldRaw, { system: countProxy(base) }, "and it survives a second compaction");
});
