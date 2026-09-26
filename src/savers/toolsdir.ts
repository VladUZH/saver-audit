// Where `--install-savers` puts the savers, and what it can install on this machine.
// No network code here, so detection and the report can import it on every run.
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

export const RTK_TAG = "v0.50.0";
export const CAVEMAN_BIN_TAG = "bin-v1.1.7";
export const HEADROOM_VERSION = "0.38.0";
export const TOKEN_SAVER_TAG = "v3.0.0";
export const LEAN_CTX_TAG = "v3.10.3";

export function toolsDir(): string {
  // An empty SAVER_AUDIT_HOME counts as unset: "" would put the tools in the current folder.
  // A relative one is made absolute: the install steps and the replays run the savers
  // in other folders, where a relative path would point somewhere else.
  return join(resolve(process.env.SAVER_AUDIT_HOME || join(homedir(), ".saver-audit")), "tools");
}

const EXE = process.platform === "win32" ? ".exe" : "";

export const toolPaths = {
  rtk: () => join(toolsDir(), "bin", `rtk${EXE}`),
  caveman: () => join(toolsDir(), "bin", `caveman-engine${EXE}`),
  headroomPython: () => join(toolsDir(), "headroom-venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python"),
  hfHome: () => join(toolsDir(), "hf"),
  /** tiktoken's o200k_base vocabulary, which headroom counts tokens with (TIKTOKEN_CACHE_DIR). */
  tiktoken: () => join(toolsDir(), "tiktoken"),
  headroomState: () => join(toolsDir(), "headroom-state"),
};

/**
 * A program in one of PATH's absolute folders, by full path; undefined if none has it.
 * For Windows, where a bare name is looked up in the current folder first.
 */
export function onPathOnly(file: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    try {
      lstatSync(join(dir, file)); // lstat: the Store's python.exe alias is a link stat cannot follow
      return join(dir, file);
    } catch {
      // not in this folder
    }
  }
  return undefined;
}

/** python3, python, then versioned names on PATH (a python3.12 next to an older python3), newest first. */
function pythonCandidates(): string[][] {
  if (process.platform === "win32") {
    return [["py.exe", "-3"], ["python.exe"]].flatMap(([exe, ...pre]) => {
      const p = onPathOnly(exe!);
      return p ? [[p, ...pre]] : [];
    });
  }
  const versioned = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    try {
      for (const f of readdirSync(dir)) if (/^python3\.\d+$/.test(f)) versioned.add(f);
    } catch {
      // not a readable folder
    }
  }
  const minor = (name: string) => Number(name.slice("python3.".length));
  return [["python3"], ["python"], ...[...versioned].sort((a, b) => minor(b) - minor(a)).map((n) => [n])];
}

/**
 * A Python 3.10+ on PATH, as the interpreter's absolute path (sys.executable), so the
 * savers keep using it when run with another PATH or HOME (version-manager shims
 * resolve through HOME). Undefined when there is none.
 */
export function findPython(): string | undefined {
  for (const [cmd, ...pre] of pythonCandidates()) {
    const r = spawnSync(cmd!, [...pre, "-c", "import sys; print('%d.%d' % sys.version_info[:2]); print(sys.executable)"], { encoding: "utf8" });
    const [version = "", exe = ""] = (r.stdout ?? "").trim().split(/\r?\n/).map((l) => l.trim());
    const [maj, min] = version.split(".").map(Number);
    if (r.status !== 0 || !(maj! > 3 || (maj === 3 && min! >= 10))) continue;
    if (exe) return exe;
    if (!pre.length) return cmd;
  }
  return undefined;
}

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

export interface InstallChoice {
  id: "rtk" | "caveman-engine" | "token-saver" | "lean-ctx" | "headroom";
  what: string;
  size: string;
  available: boolean;
  why?: string;
  /** Needs Python 3.10+, so whether it is available depends on the Python found. */
  python?: true;
}

/** What can be installed on this machine, for the confirmation prompt and the [i] key. `py`: null for none. */
export function installPlan(platform: string = process.platform, arch: string = process.arch, py: string | null | undefined = findPython()): InstallChoice[] {
  // Debian and Ubuntu ship Python without its venv module (package python3-venv). -I:
  // never an ensurepip.py or venv.py from the current folder.
  const venv = !!py && spawnSync(py, ["-I", "-c", "import ensurepip, venv"], { stdio: "ignore" }).status === 0;
  const build = (asset: string | undefined) => ({ available: !!asset, why: asset ? undefined : "no build for this platform" });
  return [
    { id: "rtk", what: `rtk ${RTK_TAG}`, size: "about 4 MB, seconds", ...build(rtkAsset(platform, arch)) },
    { id: "caveman-engine", what: `caveman engine ${CAVEMAN_BIN_TAG}`, size: "about 28 MB; its first measurement then takes about a minute, cached after", ...build(cavemanAsset(platform, arch)) },
    { id: "token-saver", what: `token-saver ${TOKEN_SAVER_TAG}`, size: "under 1 MB, seconds; needs Python 3.10+; its first measurement takes a few minutes on a busy month, cached after", available: !!py && platform !== "win32", why: platform === "win32" ? "installer supports macOS and Linux" : py ? undefined : "needs Python 3.10+", python: true },
    // On Windows a program can find the real profile folder whatever the environment says,
    // so lean-ctx's replays could read the user's settings and write into their profile.
    { id: "lean-ctx", what: `lean-ctx ${LEAN_CTX_TAG}`, size: "about 23 MB; its first measurement takes a few minutes on a busy month, cached after", ...(platform === "win32" ? { available: false, why: "its settings cannot be kept apart from yours on Windows" } : build(leanCtxAsset(platform, arch))) },
    { id: "headroom", what: `headroom ${HEADROOM_VERSION} + its model`, size: "about 1.6 GB, a few minutes", available: venv, why: !py ? "needs Python 3.10+" : venv ? undefined : "needs Python's venv module; on Debian or Ubuntu: sudo apt install python3-venv", python: true },
  ];
}

/** What [i] and --install-savers can do for the missing savers. */
export interface InstallOffer {
  /** Missing savers the installer can install here (or will try: one that needs Python, along with others that do not). */
  ids: string[];
  /** Why each other missing built-in saver cannot be installed here. */
  why: Map<string, string>;
}

/**
 * What the installer can do for the missing savers; the [i] key is offered when `ids`
 * is not empty. headroom is left out (1.6 GB: --with-headroom only). Python is never
 * looked for: the report builds this on every run, and on a Mac without developer
 * tools running python3 opens a dialog offering to install them. A saver that needs
 * Python is tried along with ones that do not ([i] looks for Python and says why if it
 * cannot); alone, it is left to --install-savers.
 */
export function installOffer(savers: Array<{ id: string; status: string }>, plan: InstallChoice[] = installPlan(process.platform, process.arch, null)): InstallOffer {
  const missing = savers.filter((s) => s.status === "not installed" && s.id !== "headroom").map((s) => s.id);
  const can = (id: string) => plan.some((c) => c.id === id && c.available);
  const python = (id: string) => plan.some((c) => c.id === id && c.python);
  const others = missing.some(can);
  const ids = missing.filter((id) => can(id) || (others && python(id)));
  const why = new Map(missing.flatMap((id): Array<[string, string]> => {
    const c = plan.find((x) => x.id === id);
    if (ids.includes(id) || !c?.why) return [];
    return [[id, c.python ? `${c.why}; to install: npx saver-audit --install-savers` : c.why]]; // Python not looked for
  }));
  return { ids, why };
}
