// Installs the replayed savers into ~/.saver-audit/tools, on request only (the
// `[i]` key or --install-savers). This is the second module allowed to use the
// network (test/offline.test.ts); it says so before downloading anything.
//
// - Downloads come from each saver's official GitHub release, pinned to the version
//   the adapters were written for, and are verified before use: rtk against its
//   release checksums, the caveman engine against checksums signed with caveman's
//   public key (the same check caveman's own installer makes).
// - Never runs a saver's own init/setup, so Claude Code and Codex settings stay
//   untouched. Deleting the folder uninstalls everything.
// - Saver code is downloaded by the user from its authors, never bundled here
//   (caveman's engine is BSL-1.1).
import { spawn, spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, win32 } from "node:path";
import { findPython, toolPaths, toolsDir } from "./toolsdir.ts";

export const RTK_TAG = "v0.50.0";
export const CAVEMAN_BIN_TAG = "bin-v1.1.7";
export const HEADROOM_VERSION = "0.38.0";
export const TOKEN_SAVER_TAG = "v3.0.0";
// token-saver publishes no checksums; this is the SHA-256 of its v3.0.0 source archive
// as downloaded on 2026-09-25 (tech-notes §8.10).
const TOKEN_SAVER_SHA256 = "bf1531a061a557d428601a1e6ce232e8612cc41c7e532e15e79b06fa54bda025";
export const LEAN_CTX_TAG = "v3.10.3";

// caveman packages/cli/BINARY_SIGNING_PUBKEY.pub at v2.7.0.
const CAVEMAN_PUBKEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEKR5zq0dz0mTUtkiX0b6jqtyG3uQV
89PGD2n9UBV1ikbhu0f1c+vHtcN9mk6wKzyBLdEPudI/Jnvci+8OAen/vw==
-----END PUBLIC KEY-----`;

const EXE = process.platform === "win32" ? ".exe" : "";
const paths = toolPaths;

/** Release builds exist for 64-bit Intel and ARM only; other CPUs get none. */
const cpu = (arch: string) => (arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined);

export function rtkAsset(platform: string = process.platform, arch: string = process.arch): string | undefined {
  const a = cpu(arch);
  if (!a) return undefined;
  if (platform === "darwin") return `rtk-${a}-apple-darwin.tar.gz`;
  if (platform === "linux") return arch === "arm64" ? "rtk-aarch64-unknown-linux-gnu.tar.gz" : "rtk-x86_64-unknown-linux-musl.tar.gz";
  if (platform === "win32" && arch === "x64") return "rtk-x86_64-pc-windows-msvc.zip";
  return undefined;
}

export function cavemanAsset(platform: string = process.platform, arch: string = process.arch): string | undefined {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "win32" : undefined;
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : undefined;
  return os && a ? `caveman-engine_${os}_${a}` : undefined;
}

export function leanCtxAsset(platform: string = process.platform, arch: string = process.arch): string | undefined {
  const a = cpu(arch);
  if (!a) return undefined;
  if (platform === "darwin") return `lean-ctx-${a}-apple-darwin.tar.gz`;
  if (platform === "linux") return `lean-ctx-${a}-unknown-linux-musl.tar.gz`;
  if (platform === "win32" && arch === "x64") return "lean-ctx-x86_64-pc-windows-msvc.zip";
  return undefined;
}

/** SHA-256 for `name` from a checksums file ("<hex>  <name>" or "<hex> *<name>"). */
export function checksumFor(sums: string, name: string): string | undefined {
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/.exec(line.trim());
    if (m && m[2] === name) return m[1];
  }
  return undefined;
}

/** caveman's check: a sigstore bundle signing checksums.txt with caveman's key. */
export function cavemanSignatureValid(sums: Buffer, bundleJson: string, pubkey = CAVEMAN_PUBKEY): boolean {
  try {
    const b = JSON.parse(bundleJson);
    const sig = b?.messageSignature;
    if (sig?.messageDigest?.algorithm !== "SHA2_256" || typeof sig.signature !== "string") return false;
    if (!createHash("sha256").update(sums).digest().equals(Buffer.from(sig.messageDigest.digest, "base64"))) return false;
    return verify("sha256", sums, createPublicKey(pubkey), Buffer.from(sig.signature, "base64"));
  } catch {
    return false;
  }
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * The deadline covers the connection and the response headers. The body may take as
 * long as a slow link needs; it is aborted only when no bytes arrive for `stallMs`.
 */
export async function download(url: string, headersMs = 120_000, stallMs = 30_000): Promise<Buffer> {
  const ac = new AbortController();
  const abortIn = (ms: number, why: string) => setTimeout(() => ac.abort(new Error(`${url}: ${why}`)), ms);
  const aborted = new Promise<never>((_, reject) => ac.signal.addEventListener("abort", () => reject(ac.signal.reason), { once: true }));
  aborted.catch(() => {});
  let timer = abortIn(headersMs, `no response in ${headersMs / 1000} s`);
  try {
    const res = await Promise.race([fetch(url, { redirect: "follow", signal: ac.signal }), aborted]);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      clearTimeout(timer);
      timer = abortIn(stallMs, `download stalled (nothing received for ${stallMs / 1000} s)`);
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

export type Say = (s: string) => void;

/**
 * On Windows, the system's own tar (bsdtar): it reads .zip and C:\ paths. A GNU tar
 * first on PATH (Git Bash) reads neither.
 */
export function tarCommand(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  return platform === "win32" ? win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

/** Runs tar; on failure the error carries tar's own message. */
function untar(what: string, args: string[]): void {
  const r = spawnSync(tarCommand(), args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (r.error) throw new Error(`${what}: could not run \`tar\` (${r.error.message})`);
  const why = (r.stderr ?? "").split("\n").find((l) => l.trim())?.trim();
  if (r.status !== 0) throw new Error(`${what}: could not unpack the archive (tar: ${why ?? `exit ${r.status ?? r.signal}`})`);
}

/** `--version` succeeds: the program is not for another CPU, truncated or corrupt. */
function runsHere(file: string): boolean {
  const r = spawnSync(file, ["--version"], { input: "", stdio: ["pipe", "ignore", "ignore"], timeout: 30_000 });
  if (r.error) return (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return r.status === 0;
}

/**
 * Puts a program into the tools folder in one step: written next to its target,
 * checked, then renamed. A failed install leaves nothing that detection would find.
 */
function place(what: string, data: Buffer, target: string, check: boolean): void {
  mkdirSync(dirname(target), { recursive: true });
  const part = join(dirname(target), `.partial-${process.pid}-${basename(target)}`);
  try {
    writeFileSync(part, data, { mode: 0o755 });
    chmodSync(part, 0o755);
    if (check && !runsHere(part)) throw new Error(`${what}: the downloaded program does not run on this machine (${process.platform}/${process.arch}), not installed`);
    renameSync(part, target);
  } finally {
    rmSync(part, { force: true });
  }
}

/** Extracts one program from a downloaded archive, then places it (above). */
function unpack(what: string, archive: Buffer, name: string, member: string, target: string): void {
  const tmp = mkdtempSync(join(tmpdir(), "saver-audit-dl-"));
  try {
    const file = join(tmp, name);
    writeFileSync(file, archive);
    untar(what, ["-xf", file, "-C", tmp, member]);
    if (!existsSync(join(tmp, member))) throw new Error(`${what}: ${member} is missing from ${name}`);
    place(what, readFileSync(join(tmp, member)), target, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function installRtk(say: Say): Promise<string> {
  const asset = rtkAsset();
  if (!asset) throw new Error(`rtk ${RTK_TAG} has no release build for ${process.platform}/${process.arch}`);
  const base = `https://github.com/rtk-ai/rtk/releases/download/${RTK_TAG}`;
  say(`downloading rtk ${RTK_TAG} from github.com/rtk-ai/rtk…`);
  const [archive, sums] = await Promise.all([download(`${base}/${asset}`), download(`${base}/checksums.txt`)]);
  const want = checksumFor(sums.toString("utf8"), asset);
  if (!want || want !== sha256(archive)) throw new Error("rtk: checksum mismatch, not installed");
  unpack("rtk", archive, asset, `rtk${EXE}`, paths.rtk());
  return paths.rtk();
}

export async function installCaveman(say: Say): Promise<string> {
  const asset = cavemanAsset();
  if (!asset) throw new Error(`caveman engine has no release build for ${process.platform}/${process.arch}`);
  const base = `https://github.com/JuliusBrussee/caveman/releases/download/${CAVEMAN_BIN_TAG}`;
  say(`downloading the caveman engine (${CAVEMAN_BIN_TAG}, BSL-1.1) from github.com/JuliusBrussee/caveman…`);
  const name = `${asset}${process.platform === "win32" ? ".exe" : ""}`;
  const [bin, sums, sig] = await Promise.all([download(`${base}/${asset}`), download(`${base}/checksums.txt`), download(`${base}/checksums.txt.keysig`)]);
  if (!cavemanSignatureValid(sums, sig.toString("utf8"))) throw new Error("caveman engine: checksum signature invalid, not installed");
  const want = checksumFor(sums.toString("utf8"), asset) ?? checksumFor(sums.toString("utf8"), name);
  if (!want || want !== sha256(bin)) throw new Error("caveman engine: checksum mismatch, not installed");
  place("caveman engine", bin, paths.caveman(), false); // no --version to check it with
  return paths.caveman();
}

export async function installLeanCtx(say: Say): Promise<string> {
  const asset = leanCtxAsset();
  if (!asset) throw new Error(`lean-ctx ${LEAN_CTX_TAG} has no release build for ${process.platform}/${process.arch}`);
  const base = `https://github.com/yvgude/lean-ctx/releases/download/${LEAN_CTX_TAG}`;
  say(`downloading lean-ctx ${LEAN_CTX_TAG} from github.com/yvgude/lean-ctx…`);
  const [archive, sums] = await Promise.all([download(`${base}/${asset}`), download(`${base}/SHA256SUMS`)]);
  const want = checksumFor(sums.toString("utf8"), asset);
  if (!want || want !== sha256(archive)) throw new Error("lean-ctx: checksum mismatch, not installed");
  const target = join(toolsDir(), "bin", `lean-ctx${EXE}`);
  unpack("lean-ctx", archive, asset, `lean-ctx${EXE}`, target);
  return target;
}

/** token-saver runs from its source with Python; its own installer (which edits Claude Code settings) is not used. */
export async function installTokenSaver(say: Say): Promise<string> {
  if (process.platform === "win32") throw new Error("the token-saver installer here supports macOS and Linux");
  const py = findPython();
  if (!py) throw new Error("token-saver needs Python 3.10 or newer on PATH");
  say(`downloading token-saver ${TOKEN_SAVER_TAG} from github.com/ppgranger/token-saver…`);
  const archive = await download(`https://github.com/ppgranger/token-saver/archive/refs/tags/${TOKEN_SAVER_TAG}.tar.gz`);
  if (sha256(archive) !== TOKEN_SAVER_SHA256) throw new Error("token-saver: archive hash differs from the pinned one, not installed");
  const dir = join(toolsDir(), "token-saver");
  // Unpacked next to its final folder, then renamed, so a failed unpack leaves no half copy.
  const part = `${dir}.partial-${process.pid}`;
  const tmp = mkdtempSync(join(tmpdir(), "saver-audit-ts-"));
  try {
    const file = join(tmp, "token-saver.tar.gz");
    writeFileSync(file, archive);
    mkdirSync(part, { recursive: true });
    untar("token-saver", ["-xzf", file, "-C", part, "--strip-components", "1"]);
    if (!existsSync(join(part, "bin", "token-saver"))) throw new Error("token-saver: bin/token-saver is missing from the archive");
    rmSync(dir, { recursive: true, force: true });
    renameSync(part, dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(part, { recursive: true, force: true });
  }
  const wrapper = join(toolsDir(), "bin", "token-saver");
  place("token-saver", Buffer.from(tokenSaverWrapper(py, join(dir, "bin", "token-saver"))), wrapper, false);
  return wrapper;
}

/** Runs token-saver with the Python found at install time, not whatever `python3` is at replay time. */
export function tokenSaverWrapper(python: string, script: string): string {
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  return `#!/bin/sh\nexec ${q(python)} ${q(script)} "$@"\n`;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, onLine: Say): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const feed = (b: Buffer) => {
      const lines = b.toString("utf8").split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) onLine(lines[lines.length - 1]!.trim().slice(0, 100));
      tail = (tail + b.toString("utf8")).slice(-2000);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${tail.trim().split("\n").pop()}`))));
  });
}

const PREFETCH = `
from headroom.transforms.kompress_compressor import prefetch_kompress_artifacts, _load_kompress
from huggingface_hub import snapshot_download
prefetch_kompress_artifacts()
snapshot_download("answerdotai/ModernBERT-base", allow_patterns=["tokenizer*", "special_tokens_map.json", "config.json"])
_load_kompress(allow_download=False)
print("ready")
`;

/**
 * headroom into its own virtualenv, with its compression model. Steps found while
 * building the adapter (tech-notes §8.7): onnxruntime is not pulled in by the [ml]
 * extra, and the model's tokenizer files are not fetched by headroom's prefetch.
 */
export async function installHeadroom(say: Say): Promise<string> {
  const py = findPython();
  if (!py) throw new Error("headroom needs Python 3.10 or newer on PATH");
  const venv = join(toolsDir(), "headroom-venv");
  const env = { ...process.env, DO_NOT_TRACK: "1", HEADROOM_BEACON: "off", HF_HOME: paths.hfHome(), HEADROOM_WORKSPACE_DIR: paths.headroomState(), PIP_DISABLE_PIP_VERSION_CHECK: "1" };
  mkdirSync(toolsDir(), { recursive: true });
  say("creating a Python environment for headroom…");
  await run(py, ["-m", "venv", venv], env, say);
  say(`installing headroom-ai ${HEADROOM_VERSION} from PyPI (about 1.3 GB, a few minutes)…`);
  await run(paths.headroomPython(), ["-m", "pip", "install", "--quiet", `headroom-ai[ml]==${HEADROOM_VERSION}`, "onnxruntime>=1.24"], env, (l) => say(`pip: ${l}`));
  say("downloading headroom's compression model from Hugging Face (about 260 MB)…");
  await run(paths.headroomPython(), ["-c", PREFETCH], env, (l) => say(`model: ${l}`));
  return paths.headroomPython();
}

export interface InstallChoice {
  id: "rtk" | "caveman-engine" | "token-saver" | "lean-ctx" | "headroom";
  what: string;
  size: string;
  available: boolean;
  why?: string;
}

/** What can be installed on this machine, for the confirmation prompt. */
export function installPlan(): InstallChoice[] {
  const py = findPython();
  return [
    { id: "rtk", what: `rtk ${RTK_TAG}`, size: "about 4 MB, seconds", available: !!rtkAsset(), why: rtkAsset() ? undefined : "no build for this platform" },
    { id: "caveman-engine", what: `caveman engine ${CAVEMAN_BIN_TAG}`, size: "about 28 MB; its first measurement then takes about a minute, cached after", available: !!cavemanAsset(), why: cavemanAsset() ? undefined : "no build for this platform" },
    { id: "token-saver", what: `token-saver ${TOKEN_SAVER_TAG}`, size: "under 1 MB, seconds; needs Python 3.10+; its first measurement takes a few minutes on a busy month, cached after", available: !!py && process.platform !== "win32", why: py ? (process.platform === "win32" ? "installer supports macOS and Linux" : undefined) : "needs Python 3.10+" },
    { id: "lean-ctx", what: `lean-ctx ${LEAN_CTX_TAG}`, size: "about 23 MB; its first measurement takes a few minutes on a busy month, cached after", available: !!leanCtxAsset(), why: leanCtxAsset() ? undefined : "no build for this platform" },
    { id: "headroom", what: `headroom ${HEADROOM_VERSION} + its model`, size: "about 1.6 GB, a few minutes", available: !!py, why: py ? undefined : "needs Python 3.10+" },
  ];
}

export async function install(id: InstallChoice["id"], say: Say): Promise<string> {
  if (id === "rtk") return installRtk(say);
  if (id === "caveman-engine") return installCaveman(say);
  if (id === "token-saver") return installTokenSaver(say);
  if (id === "lean-ctx") return installLeanCtx(say);
  return installHeadroom(say);
}
