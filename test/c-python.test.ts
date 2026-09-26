// Which Python the installer picks, and how token-saver's wrapper runs it. Fake
// interpreters only (sh scripts that answer the version probe).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenSaverWrapper } from "../src/savers/install.ts";
import { findPython } from "../src/savers/toolsdir.ts";

const unix = process.platform === "win32" ? "needs sh" : false;
const dir = mkdtempSync(join(tmpdir(), "sa-py-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A fake interpreter: prints its version and its own path, as the probe asks. */
function fakePython(name: string, version: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\nif [ "$1" = "-c" ]; then printf '%s\\n%s\\n' '${version}' "$0"; exit 0; fi\necho "ran $*"\n`, { mode: 0o755 });
  return file;
}

test("a versioned python3.x is found when python3 is older than 3.10, newest first", { skip: unix }, () => {
  fakePython("python3", "3.9");
  fakePython("python3.11", "3.11");
  const py312 = fakePython("python3.12", "3.12");
  const path = process.env.PATH;
  process.env.PATH = dir;
  try {
    assert.equal(findPython(), py312, "the absolute path of the newest suitable interpreter");
  } finally {
    process.env.PATH = path;
  }
});

test("token-saver's wrapper runs the interpreter found at install time, whatever PATH and HOME are later", { skip: unix }, () => {
  const py = fakePython("py 3.12's", "3.12");
  const wrapper = join(dir, "token-saver");
  writeFileSync(wrapper, tokenSaverWrapper(py, "/opt/token saver/bin/token-saver"), { mode: 0o755 });
  const out = execFileSync(wrapper, ["compress", "git log"], { env: { PATH: "/nonexistent", HOME: "/nonexistent" }, encoding: "utf8" });
  assert.equal(out.trim(), "ran /opt/token saver/bin/token-saver compress git log");
});
