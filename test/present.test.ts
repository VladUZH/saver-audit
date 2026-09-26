import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keyMenu, Spinner } from "../src/report/present.ts";

const src = (path: string) => JSON.stringify(new URL(`../src/${path}`, import.meta.url).href);

test("Ctrl+C during a menu action (an exact replay) interrupts the program instead of leaving it running", async () => {
  const stdin = process.stdin as NodeJS.ReadStream;
  const saved = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode, kill: process.kill };
  const raw: boolean[] = [];
  const signals: unknown[] = [];
  let finish: () => void = () => {};
  stdin.isTTY = true;
  stdin.setRawMode = ((b: boolean) => (raw.push(b), stdin)) as never;
  process.kill = ((_pid: number, sig?: string | number) => (signals.push(sig), true)) as typeof process.kill;
  try {
    let closed = false;
    const menu = keyMenu({ write: () => true } as never, () => [{ key: "e", label: "exact", run: () => new Promise<void>((r) => (finish = r)) }], false).then(() => (closed = true));
    stdin.emit("data", Buffer.from("e"));
    stdin.emit("data", Buffer.from("\u0003"));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(signals, ["SIGINT"], "no SIGINT handler (no replay running): a real interrupt, so the process ends");
    assert.equal(raw.at(-1), false, "terminal back to normal first");
    assert.equal(closed, false);
    finish();
    await new Promise((r) => setTimeout(r, 20));
    stdin.emit("data", Buffer.from("q"));
    await menu;
  } finally {
    stdin.isTTY = saved.isTTY;
    stdin.setRawMode = saved.setRawMode;
    process.kill = saved.kill;
    stdin.pause();
  }
});

test("Ctrl+C in the menu during an exact replay removes the savers' state where a signal to itself ends the process at once (Windows)", { skip: process.platform === "win32" ? "the fake saver is a script" : false }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "sa-menu-"));
  try {
    // The real menu and replay in a process where, as on Windows, a SIGINT it sends
    // itself ends it before any handler runs. Ctrl+C once the saver has stored input.
    const script = `
      import { existsSync, readdirSync } from "node:fs";
      import { join } from "node:path";
      import { keyMenu } from ${src("report/present.ts")};
      import { runReplays } from ${src("savers/replay.ts")};
      const kill = process.kill.bind(process);
      process.kill = (pid, sig) => kill(pid, pid === process.pid ? "SIGKILL" : sig);
      process.stdin.isTTY = true;
      process.stdin.setRawMode = () => process.stdin;
      const jobs = [0, 1].map((i) => ({ saver: "caveman-engine", key: "k" + i, tool: "Bash", cls: "c", baseline: 100, headerTokens: 0, addTokens: 0, timeline: "main", block: i, input: i + " SLOW tool output", args: [] }));
      const f = { file: "f", source: "claude-code", records: [], skippedLines: 0, savers: { timelines: { main: { blocks: jobs.map(() => ({ d: [0] })) } }, jobs, covered: [0], toolTokens: 0 } };
      const tools = new Map([["caveman-engine", { saver: "caveman-engine", command: ${JSON.stringify(fileURLToPath(new URL("./fixtures/bin/fake-saver", import.meta.url)))}, env: { FAKE_SLEEP_MS: "30000", FAKE_STATE: "1" } }]]);
      keyMenu({ write: () => true }, () => [{ key: "e", label: "exact", run: () => runReplays([f], ["caveman-engine"], { tools, full: true, concurrency: 2 }) }], false);
      process.stdin.emit("data", Buffer.from("e"));
      const stored = () => readdirSync(process.env.TMPDIR).some((d) => existsSync(join(process.env.TMPDIR, d, "caveman", "ccr.db")));
      let n = 0;
      const timer = setInterval(() => {
        const ready = stored();
        if (ready) process.stdin.emit("data", Buffer.from("\\u0003"));
        if (ready || ++n > 200) clearInterval(timer);
      }, 50);`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TMPDIR: temp }, stdio: "ignore" });
    const exited = new Promise<NodeJS.Signals | null>((r) => child.on("exit", (_code, sig) => r(sig)));
    let timedOut = false;
    const limit = setTimeout(() => ((timedOut = true), child.kill("SIGKILL")), 20_000);
    const sig = await exited;
    clearTimeout(limit);
    assert.equal(timedOut, false, "Ctrl+C ended the run");
    assert.equal(sig, "SIGKILL", "ended by its own signal, as Windows ends it");
    assert.deepEqual(readdirSync(temp), [], "the state folder (copies of tool output) is gone");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("a spinner without colour writes no colour codes", () => {
  const writes: string[] = [];
  const out = { write: (s: string) => (writes.push(s), true), columns: 80 } as never;
  const s = new Spinner(out, true, false);
  s.set("Reading logs…");
  s.stop();
  assert.ok(writes.some((w) => w.includes("Reading logs…")));
  assert.equal(writes.some((w) => /\x1b\[\d+m/.test(w)), false);
});

test("an error in a menu action is reported and the menu stays usable", async () => {
  const stdin = process.stdin as NodeJS.ReadStream;
  const saved = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode };
  stdin.isTTY = true;
  stdin.setRawMode = (() => stdin) as never;
  const written: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const menu = keyMenu({ write: (s: string) => (written.push(s), true) } as never, () => [{ key: "e", label: "exact", run: async () => { throw new Error("EACCES: permission denied"); } }], false);
    stdin.emit("data", Buffer.from("e"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.emit("data", Buffer.from("q"));
    await Promise.race([menu, new Promise((_, reject) => setTimeout(() => reject(new Error("the menu no longer takes keys")), 500))]);
    assert.deepEqual(unhandled, []);
    const text = written.join("");
    assert.match(text, /\nsaver-audit: EACCES: permission denied\n/);
    assert.equal(text.match(/\[q\] quit/g)?.length, 2, "the menu is shown again");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    stdin.isTTY = saved.isTTY;
    stdin.setRawMode = saved.setRawMode;
    stdin.pause();
  }
});
