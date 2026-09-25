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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolPaths, toolsDir } from "./toolsdir.ts";

export const RTK_TAG = "v0.50.0";
export const CAVEMAN_BIN_TAG = "bin-v1.1.7";
export const HEADROOM_VERSION = "0.38.0";

// caveman packages/cli/BINARY_SIGNING_PUBKEY.pub at v2.7.0.
const CAVEMAN_PUBKEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEKR5zq0dz0mTUtkiX0b6jqtyG3uQV
89PGD2n9UBV1ikbhu0f1c+vHtcN9mk6wKzyBLdEPudI/Jnvci+8OAen/vw==
-----END PUBLIC KEY-----`;

const EXE = process.platform === "win32" ? ".exe" : "";
const paths = toolPaths;

type Arch = "arm64" | "x64";

export function rtkAsset(platform = process.platform, arch = process.arch as Arch): string | undefined {
  const a = arch === "arm64" ? "aarch64" : "x86_64";
  if (platform === "darwin") return `rtk-${a}-apple-darwin.tar.gz`;
  if (platform === "linux") return arch === "arm64" ? "rtk-aarch64-unknown-linux-gnu.tar.gz" : "rtk-x86_64-unknown-linux-musl.tar.gz";
  if (platform === "win32" && arch === "x64") return "rtk-x86_64-pc-windows-msvc.zip";
  return undefined;
}

export function cavemanAsset(platform = process.platform, arch = process.arch as Arch): string | undefined {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "win32" : undefined;
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : undefined;
  return os && a ? `caveman-engine_${os}_${a}` : undefined;
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

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export type Say = (s: string) => void;

export async function installRtk(say: Say): Promise<string> {
  const asset = rtkAsset();
  if (!asset) throw new Error(`rtk ${RTK_TAG} has no release build for ${process.platform}/${process.arch}`);
  const base = `https://github.com/rtk-ai/rtk/releases/download/${RTK_TAG}`;
  say(`downloading rtk ${RTK_TAG} from github.com/rtk-ai/rtk…`);
  const [archive, sums] = await Promise.all([download(`${base}/${asset}`), download(`${base}/checksums.txt`)]);
  const want = checksumFor(sums.toString("utf8"), asset);
  if (!want || want !== sha256(archive)) throw new Error("rtk: checksum mismatch, not installed");
  const tmp = mkdtempSync(join(tmpdir(), "saver-audit-rtk-"));
  try {
    const file = join(tmp, asset);
    writeFileSync(file, archive);
    mkdirSync(join(toolsDir(), "bin"), { recursive: true });
    const r = spawnSync("tar", ["-xf", file, "-C", join(toolsDir(), "bin"), `rtk${EXE}`], { stdio: "ignore" });
    if (r.status !== 0 || !existsSync(paths.rtk())) throw new Error("rtk: could not unpack the archive (needs `tar`)");
    chmodSync(paths.rtk(), 0o755);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
  mkdirSync(join(toolsDir(), "bin"), { recursive: true });
  writeFileSync(paths.caveman(), bin, { mode: 0o755 });
  return paths.caveman();
}

/** A Python 3.10+ interpreter on PATH, or undefined. */
export function findPython(): string | undefined {
  for (const cmd of process.platform === "win32" ? ["py", "python"] : ["python3", "python"]) {
    const args = cmd === "py" ? ["-3", "-c"] : ["-c"];
    const r = spawnSync(cmd, [...args, "import sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
    const [maj, min] = (r.stdout ?? "").trim().split(".").map(Number);
    if (r.status === 0 && (maj! > 3 || (maj === 3 && min! >= 10))) return cmd;
  }
  return undefined;
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
  await run(py, [...(py === "py" ? ["-3"] : []), "-m", "venv", venv], env, say);
  say(`installing headroom-ai ${HEADROOM_VERSION} from PyPI (about 1.3 GB, a few minutes)…`);
  await run(paths.headroomPython(), ["-m", "pip", "install", "--quiet", `headroom-ai[ml]==${HEADROOM_VERSION}`, "onnxruntime>=1.24"], env, (l) => say(`pip: ${l}`));
  say("downloading headroom's compression model from Hugging Face (about 260 MB)…");
  await run(paths.headroomPython(), ["-c", PREFETCH], env, (l) => say(`model: ${l}`));
  return paths.headroomPython();
}

export interface InstallChoice {
  id: "rtk" | "caveman-engine" | "headroom";
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
    { id: "caveman-engine", what: `caveman engine ${CAVEMAN_BIN_TAG}`, size: "about 28 MB, seconds", available: !!cavemanAsset(), why: cavemanAsset() ? undefined : "no build for this platform" },
    { id: "headroom", what: `headroom ${HEADROOM_VERSION} + its model`, size: "about 1.6 GB, a few minutes", available: !!py, why: py ? undefined : "needs Python 3.10+" },
  ];
}

export async function install(id: InstallChoice["id"], say: Say): Promise<string> {
  if (id === "rtk") return installRtk(say);
  if (id === "caveman-engine") return installCaveman(say);
  return installHeadroom(say);
}
