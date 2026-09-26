// Writing the share card never writes through a link at its path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/pool.ts";
import { writeCard } from "../src/report/card.ts";
import { fixtureOptions } from "./helpers.ts";

test("a saver-audit.png that links to another file is replaced, and that file is untouched", { skip: process.platform === "win32" ? "symlinks need rights on Windows" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-card-link-"));
  try {
    const r = await runAudit(fixtureOptions(), undefined, 1);
    writeFileSync(join(dir, ".zshrc"), "export PATH=keep\n");
    writeFileSync(join(dir, "authorized_keys"), "ssh-ed25519 keep\n");
    symlinkSync(join(dir, ".zshrc"), join(dir, "saver-audit.png"));
    linkSync(join(dir, "authorized_keys"), join(dir, "hard.png"));
    for (const card of ["saver-audit.png", "hard.png"]) {
      await writeCard(r, join(dir, card));
      assert.equal(lstatSync(join(dir, card)).isFile(), true, card);
      assert.deepEqual([...readFileSync(join(dir, card)).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG");
    }
    assert.equal(readFileSync(join(dir, ".zshrc"), "utf8"), "export PATH=keep\n");
    assert.equal(readFileSync(join(dir, "authorized_keys"), "utf8"), "ssh-ed25519 keep\n");
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), [], "no temporary file left");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a card that cannot be written leaves no temporary file and throws (the CLI then uses the temp folder)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-card-dir-"));
  try {
    const r = await runAudit(fixtureOptions(), undefined, 1);
    // A folder where the card should go: rename cannot replace it.
    const target = join(dir, "saver-audit.png");
    mkdirSync(target);
    await assert.rejects(writeCard(r, target));
    assert.deepEqual(readdirSync(dir), ["saver-audit.png"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
