// What the installer offers on a machine, and when the [i] key is shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canOfferInstall, installPlan, type InstallChoice } from "../src/savers/toolsdir.ts";

test("on Windows, token-saver's reason is the platform, whether or not Python is there", () => {
  for (const py of [null, "C:\\Python312\\python.exe"]) {
    const ts = installPlan("win32", "x64", py).find((c) => c.id === "token-saver")!;
    assert.equal(ts.available, false);
    assert.equal(ts.why, "installer supports macOS and Linux");
  }
  const mac = installPlan("darwin", "arm64", null).find((c) => c.id === "token-saver")!;
  assert.equal(mac.why, "needs Python 3.10+");
});

test("the plan uses the platform it is given", () => {
  const plan = installPlan("linux", "arm", null);
  for (const id of ["rtk", "lean-ctx", "caveman-engine"]) assert.equal(plan.find((c) => c.id === id)!.available, false, id);
});

/** A plan where token-saver is available only with a suitable Python; `py`: whether there is one. */
const plan = (py: boolean, calls: boolean[] = []) => (python: boolean) => {
  calls.push(python);
  return (["rtk", "caveman-engine", "token-saver", "lean-ctx", "headroom"] as const).map((id) => ({ id, what: id, size: "", available: id === "token-saver" ? python && py : true }));
};

test("[i] is offered only for a missing saver that can be installed here", () => {
  const savers = [
    { id: "rtk", status: "ok" },
    { id: "token-saver", status: "not installed" },
    { id: "headroom", status: "not installed" },
    { id: "my-saver", status: "not installed" },
  ];
  assert.equal(canOfferInstall(savers, plan(true)), true);
  assert.equal(canOfferInstall(savers, plan(false)), false, "token-saver needs Python 3.10+");
  assert.equal(canOfferInstall([{ id: "headroom", status: "not installed" }], plan(true)), false, "headroom only with --with-headroom");
  assert.equal(canOfferInstall([{ id: "my-saver", status: "not installed" }], plan(true)), false, "a community saver: the installer has nothing for it");
});

test("[i] looks for Python only when a saver that needs it is all that is missing", () => {
  const calls: boolean[] = [];
  assert.equal(canOfferInstall([{ id: "rtk", status: "ok" }], plan(true, calls)), false);
  assert.deepEqual(calls, [], "nothing missing: no plan at all");
  calls.length = 0;
  assert.equal(canOfferInstall([{ id: "rtk", status: "not installed" }, { id: "token-saver", status: "not installed" }], plan(true, calls)), true);
  assert.deepEqual(calls, [false], "rtk needs no Python");
  calls.length = 0;
  canOfferInstall([{ id: "token-saver", status: "not installed" }], plan(true, calls));
  assert.deepEqual(calls, [false, true]);
});
