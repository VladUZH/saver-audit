// Opening X and the card: a failure is reported, and Windows gets the whole link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intentUrl, openCommand, openExternal } from "../src/report/share.ts";
import { withEnv } from "./env.ts";

const unix = process.platform === "win32" ? "needs sh" : false;

test("Windows: cmd.exe by full path, and the link in quotes so '&url=' stays in it", () => {
  const url = intentUrl("I replayed 30 days & more");
  assert.match(url, /&url=/);
  const c = openCommand(url, false, "win32", { SystemRoot: "C:\\Windows" });
  assert.equal(c.cmd, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(c.verbatim, true);
  assert.deepEqual(c.args, ["/d", "/s", "/c", `start "" "${url}"`]);
  const card = openCommand("C:\\Users\\A B\\saver-audit.png", false, "win32", { SystemRoot: "D:\\Win" });
  assert.equal(card.cmd, "D:\\Win\\System32\\cmd.exe");
  assert.equal(card.args.at(-1), 'start "" "C:\\Users\\A B\\saver-audit.png"');
});

test("a missing opener is a failure, not 'Opened X'", { skip: unix }, async () => {
  await withEnv({ PATH: "/nonexistent" }, async () => {
    assert.equal(await openExternal("https://x.com/intent/tweet?text=hi&url=x"), false);
  });
});

test("an opener that exits with an error (xdg-open without a display) is a failure", { skip: unix }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-open-"));
  try {
    const opener = join(dir, process.platform === "darwin" ? "open" : "xdg-open");
    writeFileSync(opener, "#!/bin/sh\nexit ${FAKE_OPEN_EXIT:-0}\n");
    chmodSync(opener, 0o755);
    await withEnv({ PATH: `${dir}:/usr/bin:/bin`, FAKE_OPEN_EXIT: "3" }, async () => assert.equal(await openExternal("https://example.invalid"), false));
    await withEnv({ PATH: `${dir}:/usr/bin:/bin`, FAKE_OPEN_EXIT: "0" }, async () => assert.equal(await openExternal("https://example.invalid"), true));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
