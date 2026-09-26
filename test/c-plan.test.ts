// What the installer offers on a machine, and when the [i] key is shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installOffer, installPlan, type InstallChoice } from "../src/savers/toolsdir.ts";
import { withEnv } from "./env.ts";
import { FIXTURES } from "./helpers.ts";

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

/** The plan the report offers from: Python not looked for, so token-saver is not known to be installable. */
const PLAN: InstallChoice[] = (["rtk", "caveman-engine", "token-saver", "lean-ctx", "headroom"] as const).map((id) =>
  id === "token-saver" ? { id, what: id, size: "", available: false, why: "needs Python 3.10+", python: true } : { id, what: id, size: "", available: true },
);
const canOfferInstall = (savers: Array<{ id: string; status: string }>) => installOffer(savers, PLAN).ids.length > 0;

test("[i] is offered only for a missing saver that can be installed here", () => {
  assert.equal(canOfferInstall([{ id: "rtk", status: "not installed" }, { id: "my-saver", status: "not installed" }]), true);
  assert.equal(canOfferInstall([{ id: "rtk", status: "ok" }, { id: "token-saver", status: "not installed" }]), false, "token-saver alone: its Python is not looked for");
  assert.equal(canOfferInstall([{ id: "headroom", status: "not installed" }]), false, "headroom only with --with-headroom");
  assert.equal(canOfferInstall([{ id: "my-saver", status: "not installed" }]), false, "a community saver: the installer has nothing for it");
  assert.equal(canOfferInstall([{ id: "rtk", status: "ok" }]), false, "nothing missing");
});

test("the offer names what [i] would install and why the others cannot be", () => {
  const savers = [
    { id: "rtk", status: "not installed" },
    { id: "token-saver", status: "not installed" },
    { id: "my-saver", status: "not installed" },
  ];
  const withRtk = installOffer(savers, PLAN);
  assert.deepEqual(withRtk.ids, ["rtk", "token-saver"], "along with rtk, [i] tries token-saver and says why if it cannot");
  assert.deepEqual([...withRtk.why], []);
  const alone = installOffer(savers.slice(1), PLAN);
  assert.deepEqual(alone.ids, []);
  assert.deepEqual([...alone.why], [["token-saver", "needs Python 3.10+; to install: npx saver-audit --install-savers"]], "a community saver has no installer reason");
});

test("the offer never runs Python: the report builds it on every run, and python3 can open a dialog on a Mac", { skip: process.platform === "win32" ? "needs sh" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-offer-py-"));
  try {
    copyFileSync(join(FIXTURES, "installer", "fake-python"), join(dir, "python3"));
    chmodSync(join(dir, "python3"), 0o755);
    const log = join(dir, "calls.log");
    await withEnv({ PATH: dir, FAKE_PY_CWD_LOG: log }, () => {
      const alone = installOffer([{ id: "rtk", status: "ok" }, { id: "token-saver", status: "not installed" }]);
      installOffer([{ id: "rtk", status: "not installed" }, { id: "token-saver", status: "not installed" }]);
      assert.equal(existsSync(log), false, "python3 was run");
      assert.deepEqual(alone.ids, [], "not known to be installable: no [i] for it");
      assert.equal(alone.why.get("token-saver"), "needs Python 3.10+; to install: npx saver-audit --install-savers");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
