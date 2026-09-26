import { test } from "node:test";
import assert from "node:assert/strict";
import { keyMenu, Spinner } from "../src/report/present.ts";

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
    assert.deepEqual(signals, ["SIGINT"], "a real interrupt, so the replay cleans up and the process ends");
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

test("a spinner without colour writes no colour codes", () => {
  const writes: string[] = [];
  const out = { write: (s: string) => (writes.push(s), true), columns: 80 } as never;
  const s = new Spinner(out, true, false);
  s.set("Reading logs…");
  s.stop();
  assert.ok(writes.some((w) => w.includes("Reading logs…")));
  assert.equal(writes.some((w) => /\x1b\[\d+m/.test(w)), false);
});
