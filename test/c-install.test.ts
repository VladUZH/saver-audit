// Installer runs against synthetic release files: fetch is stubbed, nothing leaves the machine.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installLeanCtx, installRtk, leanCtxAsset, rtkAsset } from "../src/savers/install.ts";
import { toolPaths, toolsDir } from "../src/savers/toolsdir.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const quiet = () => {};
const unix = process.platform === "win32" ? "needs sh" : false;
const temps: string[] = [];
const temp = (prefix: string) => (temps.push(mkdtempSync(join(tmpdir(), prefix))), temps.at(-1)!);
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fresh, empty tools folder. */
function freshHome(): void {
  process.env.SAVER_AUDIT_HOME = temp("sa-inst-");
}

const binFiles = () => (existsSync(join(toolsDir(), "bin")) ? readdirSync(join(toolsDir(), "bin")) : []);

/** A .tar.gz holding one executable file. */
function tarball(name: string, body: string | Buffer): Buffer {
  const d = temp("sa-tar-");
  writeFileSync(join(d, name), body, { mode: 0o755 });
  execFileSync("tar", ["-czf", join(d, "a.tar.gz"), "-C", d, name]);
  return readFileSync(join(d, "a.tar.gz"));
}

/** Serves release files by their name in place of the network. */
function serve(files: Record<string, Buffer | string>): void {
  globalThis.fetch = (async (url: string | URL) => {
    const body = files[String(url).split("/").pop()!];
    return body === undefined ? new Response("", { status: 404 }) : new Response(new Uint8Array(Buffer.from(body)));
  }) as typeof fetch;
}

const RTK = "#!/bin/sh\necho 'rtk 0.50.0'\n";
/** Not a program for this machine (like an x86_64 build on 32-bit ARM). */
const FOREIGN = Buffer.concat([Buffer.from("\x7fELF\x01\x01\x01\x00"), randomBytes(4096)]);

test("rtk: a verified archive is unpacked into the tools folder", { skip: unix || !rtkAsset() }, async () => {
  freshHome();
  const archive = tarball("rtk", RTK);
  serve({ [rtkAsset()!]: archive, "checksums.txt": `${sha(archive)}  ${rtkAsset()}\n` });
  assert.equal(await installRtk(quiet), toolPaths.rtk());
  assert.equal(readFileSync(toolPaths.rtk(), "utf8"), RTK);
  assert.deepEqual(binFiles(), ["rtk"]);
});

test("rtk: an archive that fails to unpack leaves no program behind, and says why", { skip: unix || !rtkAsset() }, async () => {
  freshHome();
  const whole = tarball("rtk", RTK + randomBytes(1_500_000).toString("base64"));
  const archive = whole.subarray(0, whole.length >> 1); // cut off, as by a full disk
  serve({ [rtkAsset()!]: archive, "checksums.txt": `${sha(archive)}  ${rtkAsset()}\n` });
  await assert.rejects(installRtk(quiet), (err: Error) => /could not unpack the archive \(tar: /.test(err.message) && !/needs `tar`/.test(err.message));
  assert.deepEqual(binFiles(), [], "nothing that detection would count as installed");
});

test("a downloaded program that does not run on this machine is not installed", { skip: unix || !rtkAsset() || !leanCtxAsset() }, async () => {
  freshHome();
  const rtk = tarball("rtk", FOREIGN);
  const lean = tarball("lean-ctx", FOREIGN);
  serve({ [rtkAsset()!]: rtk, "checksums.txt": `${sha(rtk)}  ${rtkAsset()}\n`, [leanCtxAsset()!]: lean, SHA256SUMS: `${sha(lean)}  ${leanCtxAsset()}\n` });
  await assert.rejects(installRtk(quiet), /rtk: the downloaded program does not run on this machine/);
  await assert.rejects(installLeanCtx(quiet), /lean-ctx: the downloaded program does not run on this machine/);
  assert.deepEqual(binFiles(), []);
});
