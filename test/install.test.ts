import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cavemanAsset, cavemanSignatureValid, checksumFor, rtkAsset } from "../src/savers/install.ts";

// Real, public release files of rtk v0.50.0 and caveman bin-v1.1.7.
const dir = fileURLToPath(new URL("./fixtures/installer/", import.meta.url));
const read = (f: string) => readFileSync(dir + f);

test("release assets per platform", () => {
  assert.equal(rtkAsset("darwin", "arm64"), "rtk-aarch64-apple-darwin.tar.gz");
  assert.equal(rtkAsset("linux", "x64"), "rtk-x86_64-unknown-linux-musl.tar.gz");
  assert.equal(rtkAsset("win32", "x64"), "rtk-x86_64-pc-windows-msvc.zip");
  assert.equal(rtkAsset("win32", "arm64"), undefined, "no rtk build for Windows on ARM");
  assert.equal(cavemanAsset("linux", "x64"), "caveman-engine_linux_amd64");
  assert.equal(cavemanAsset("darwin", "arm64"), "caveman-engine_darwin_arm64");
});

test("checksums are read from the release files", () => {
  assert.match(checksumFor(read("rtk-checksums.txt").toString(), "rtk-aarch64-apple-darwin.tar.gz") ?? "", /^[0-9a-f]{64}$/);
  assert.match(checksumFor(read("caveman-checksums.txt").toString(), "caveman-engine_darwin_arm64") ?? "", /^[0-9a-f]{64}$/);
  assert.equal(checksumFor(read("rtk-checksums.txt").toString(), "not-there.tar.gz"), undefined);
});

test("caveman's signed checksums verify with its public key, and tampering fails", () => {
  const sums = read("caveman-checksums.txt");
  const sig = read("caveman-checksums.txt.keysig").toString();
  assert.equal(cavemanSignatureValid(sums, sig), true);
  const tampered = Buffer.from(sums.toString().replace(/^[0-9a-f]/, (c) => (c === "0" ? "1" : "0")));
  assert.equal(cavemanSignatureValid(tampered, sig), false);
  assert.equal(cavemanSignatureValid(sums, "{}"), false);
});
