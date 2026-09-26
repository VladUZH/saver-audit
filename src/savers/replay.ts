// Runs replayed savers on the user's own installed binaries (main thread).
// Never bundles saver code (CLAUDE.md non-negotiable 6); a saver that is not
// installed is skipped with a note. Every saver runs with telemetry off and its
// state in a temporary folder.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { countProxy } from "../accounting/tokens.ts";
import type { FileResult } from "../audit.ts";
import { readReplayCache, saveReplayCache } from "./cache.ts";
import { presentedTokens, PREVIEW_CHARS, type ReplayResult } from "./tracker.ts";
import type { ReplayJob } from "./types.ts";
import type { SaverManifest } from "./manifest.ts";
import { toolPaths, toolsDir } from "./toolsdir.ts";
import { allSavers, saverIndex, type SaverAdapter } from "./registry.ts";

export interface ReplayTool {
  saver: string;
  command: string;
  version?: string;
  /** Extra environment for this saver (a headroom installed by --install-savers keeps its model in the tools folder). */
  env?: Record<string, string>;
}

export interface ReplayStats {
  /** Unique outputs the saver applies to. */
  total: number;
  /** Outputs still to replay for exact numbers (not cached yet), after this run. */
  pending: number;
  /** Nothing measured to show: too few outputs replayed in quick mode, or most replays failed. */
  insufficient?: boolean;
  /** Why there is no number (set with `insufficient`), e.g. "every replay failed". */
  reason?: string;
  /** Unique outputs replayed in this run (not from cache). */
  ran: number;
  /** Unique outputs whose saving was extrapolated, not measured (0 when insufficient: nothing is). */
  extrapolated: number;
  /** Unique outputs whose replay failed in this run; counted as unchanged, tried again next run. */
  failed: number;
}

/** Default number of unique outputs replayed per run and saver; --full-replay lifts it. */
const CHECKPOINT = 250;

// Quick mode (default) gives each saver a few seconds: a size-stratified sample (the
// largest outputs plus a hash-order sample of the rest), extrapolated and labelled
// "indicative" (samples missed by up to 40% on a month, more on small periods; tech-notes
// §8.9-8.10). Exact mode (--exact) replays every output above each saver's size floor.
// Everything replayed is cached, so a run after --exact is exact too.
export const QUICK_SECONDS = 6;
/**
 * Per-saver quick budgets. rtk is cheap enough to always finish. headroom and the
 * caveman engine only use cached (exact) results: a few seconds of sampling was off by
 * 35–73% for caveman (rare, spiky savings) and too slow to estimate headroom at all.
 */
const QUICK_SECONDS_FOR: Record<string, number> = { rtk: 15, headroom: 0, "caveman-engine": 0 };
const quickSeconds = (saver: string) => QUICK_SECONDS_FOR[saver] ?? QUICK_SECONDS;
/** Fewer measured outputs than this to extrapolate from: no number, just "press [e]". */
export const MIN_QUICK_SAMPLE = 20;
const QUICK_REASON = "too few outputs replayed in quick mode";
/** Measured replay throughput on an M-series Mac, outputs per second (tech-notes §8.11). */
export const RATE: Record<string, number> = { rtk: 800, "caveman-engine": 250, "token-saver": 45, "lean-ctx": 45, headroom: 4 };
const DEFAULT_RATE = 20;
/** One-off start-up cost in seconds (headroom loads its model). */
const STARTUP: Record<string, number> = { headroom: 6 };

export function quickBudget(saver: string): number {
  return Math.max(100, Math.round((RATE[saver] ?? DEFAULT_RATE) * Math.max(quickSeconds(saver), QUICK_SECONDS)));
}

/** Seconds an --exact run would need for the outputs not cached yet. */
export function exactSeconds(stats: Map<string, ReplayStats>): { total: number; bySaver: Array<[string, number]> } {
  const bySaver: Array<[string, number]> = [];
  for (const [saver, st] of stats) {
    if (!st.pending) continue;
    bySaver.push([saver, st.pending / (RATE[saver] ?? DEFAULT_RATE) + (STARTUP[saver] ?? 0)]);
  }
  bySaver.sort((a, b) => b[1] - a[1]);
  return { total: bySaver.reduce((n, [, t]) => n + t, 0), bySaver };
}
/** Savers that mostly wait (interpreter start-up) run more processes than cores. */
const WAIT_BOUND = new Set(["token-saver", "lean-ctx"]);

function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, name);
    if (dir && existsSync(p)) return p;
  }
  return undefined;
}

/** A version probe: its first line, and whether the program failed (did not start or exited non-zero; a timeout is not a failure). */
function runProbe(cmd: string, args: string[], env: NodeJS.ProcessEnv | undefined): { line?: string; failed: boolean } {
  if (!env) return { failed: false }; // no state folder: not run
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000, env });
  const out = `${r.stdout ?? ""}`.trim().split("\n")[0];
  if (r.status === 0) return { line: out || undefined, failed: false };
  return { failed: (r.error as NodeJS.ErrnoException | undefined)?.code !== "ETIMEDOUT" };
}

function firstLine(cmd: string, args: string[], env: NodeJS.ProcessEnv | undefined): string | undefined {
  return runProbe(cmd, args, env).line;
}

/** The version number in a version line ("v3.0.0" → "3.0.0", "3.10.3 (official, …)" → "3.10.3"), else the line. */
export function versionOf(line: string | undefined): string | undefined {
  return line?.match(/\bv?(\d+(?:\.\d+)+(?:[-+][\w.]+)?)/)?.[1] ?? line;
}

/** Is an installed version older than the one the adapter was written for? False when either has no number. */
export function isOutdated(installed: string | undefined, adapter: string): boolean {
  const nums = (v: string) => /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v)?.slice(1).map((x) => Number(x ?? 0));
  const a = installed ? nums(installed) : undefined;
  const b = nums(adapter);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/**
 * Finds the installed saver binaries: explicit overrides, then your PATH (your own
 * installs), then the folder --install-savers uses. An older version (or one that does
 * not say its version) does not hide a current one further down. Missing tools are
 * simply absent.
 */
export function detectReplayTools(savers: SaverAdapter[] = allSavers().savers): Map<string, ReplayTool> {
  // Probes run like replays: with the manifest's environment and a temporary state
  // folder, so none writes to the user's home. Made on the first probe.
  let state: string | null | undefined;
  const probeEnv = (m?: SaverManifest) => {
    if (state === undefined) {
      try {
        state = makeStateDir();
      } catch {
        state = null;
      }
    }
    return state ? saverRunEnv(m, state) : undefined;
  };
  try {
    return detect(savers, probeEnv);
  } finally {
    try {
      if (state) rmSync(state, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a folder left in the temporary folder does not stop the audit
    }
  }
}

function detect(savers: SaverAdapter[], probeEnv: (m?: SaverManifest) => NodeJS.ProcessEnv | undefined): Map<string, ReplayTool> {
  const found = new Map<string, ReplayTool>();
  const exists = (p: string) => (existsSync(p) ? p : undefined);
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const s of savers) {
    const m = s.manifest;
    if (!m || m.method !== "replayed" || !m.binary) continue;
    const name = new RegExp(`^${m.binary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`); // "trim++ 1.0" → "1.0"
    const probe = (command: string): { tool: ReplayTool; failed: boolean } => {
      const p = m.versionArgs ? runProbe(command, m.versionArgs, probeEnv(m)) : { failed: false };
      return { tool: { saver: s.id, command, version: versionOf(p.line?.replace(name, "")) }, failed: p.failed };
    };
    const override = m.binaryEnv ? process.env[m.binaryEnv] : undefined;
    if (override) {
      found.set(s.id, probe(override).tool);
      continue;
    }
    const ours = exists(join(toolsDir(), "bin", m.binary + exe));
    const extra = (m.paths ?? []).map((p) => join(p.replace(/^~(?=\/|$)/, homedir()), m.binary + exe));
    const candidates = [...new Set([onPath(m.binary + exe), ours, ...extra.filter((p) => existsSync(p))])].filter((p): p is string => !!p);
    let pick: ReplayTool | undefined;
    for (const c of candidates) {
      const { tool: t, failed } = probe(c);
      // The installer's own copy that does not run (a truncated download, another CPU's
      // build, its Python gone): not installed, so the installer offers it again.
      if (failed && c === ours) continue;
      if (!m.versionArgs || (t.version !== undefined && !isOutdated(t.version, m.version))) {
        pick = t;
        break;
      }
      pick ??= t; // none current: the first one, as found (the report notes its version)
    }
    if (pick) found.set(s.id, pick);
  }
  const own = process.env.SAVER_AUDIT_HEADROOM_PYTHON ?? headroomPython();
  const ours = own ? undefined : exists(toolPaths.headroomPython());
  const py = own ?? ours;
  if (py) {
    const v = firstLine(py, ["-c", `${NO_CWD}; import headroom; print(getattr(headroom, '__version__', 'unknown'))`], probeEnv());
    // --install-savers keeps headroom's model, and its tokenizer vocabulary, in the tools folder.
    const vocab = toolPaths.tiktoken();
    const env = ours ? { HF_HOME: toolPaths.hfHome(), ...(existsSync(vocab) ? { TIKTOKEN_CACHE_DIR: vocab } : {}) } : undefined;
    if (v) found.set("headroom", { saver: "headroom", command: py, version: v, env });
  }
  return found;
}

/** The Python interpreter behind an installed `headroom` command. */
function headroomPython(): string | undefined {
  const cli = onPath(`headroom${process.platform === "win32" ? ".exe" : ""}`);
  return cli ? launcherPython(cli) : undefined;
}

/**
 * The Python a console script runs with: its shebang (uv, pipx), the shebang pip's Windows
 * launcher (headroom.exe) carries before its zip archive, or a python.exe next to it (a
 * virtualenv's Scripts folder).
 */
export function launcherPython(cli: string): string | undefined {
  let text: string;
  try {
    const fd = openSync(cli, "r");
    try {
      const buf = Buffer.alloc(1 << 20);
      text = buf.toString("latin1", 0, readSync(fd, buf, 0, buf.length, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
  const script = /^#!\s*(\S+python[\d.]*)\s*$/.exec(text.split("\n", 1)[0] ?? "")?.[1];
  const launcher = [...text.matchAll(/#!\s*"?([^"\r\n]*?pythonw?[\d.]*\.exe)"?\r?\n/gi)].at(-1)?.[1];
  return [script, launcher, join(dirname(cli), "python.exe")].find((p) => p && existsSync(p));
}

/**
 * The user's own settings for the savers: left out, so a replay runs with default settings
 * wherever saver-audit is started, and never writes to the user's saver state (e.g.
 * caveman's recovery store via CAVEMAN_CCR_DB, which holds copies of the input).
 */
const OWN_SETTINGS = /^(CAVEMAN|TOKEN_SAVER)_/;

/**
 * No saver reaches the network during an audit: web requests go through a proxy on a
 * local port where nothing listens, so they fail at once (headroom's tokenizer would
 * download its vocabulary; its offline flags do not cover that).
 */
const DEAD_PROXY = "http://127.0.0.1:9";
export const NO_NETWORK: Record<string, string> = Object.fromEntries([
  ...["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"].flatMap((k) => [[k, DEAD_PROXY], [k.toLowerCase(), DEAD_PROXY]]),
  ...["NO_PROXY", "no_proxy"].map((k) => [k, "localhost,127.0.0.1,::1"]),
]);

function saverEnv(stateDir: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !OWN_SETTINGS.test(k))),
    DO_NOT_TRACK: "1",
    // rtk ignores DO_NOT_TRACK, and writes a once-a-day marker into your home when it
    // warns that its Claude Code hook is not installed.
    RTK_TELEMETRY_DISABLED: "1",
    RTK_SUPPRESS_HOOK_WARNING: "1",
    HEADROOM_BEACON: "off",
    HEADROOM_OFFLINE: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    ...NO_NETWORK,
    CAVEMAN_HOME: join(stateDir, "caveman"),
    CAVEMAN_CCR_DB: join(stateDir, "caveman", "ccr.db"),
    HEADROOM_WORKSPACE_DIR: join(stateDir, "headroom"),
  };
}

/**
 * The environment a saver's program runs with: saverEnv, then the manifest's own
 * ("{state}" is the temporary state folder), then the tool's.
 */
export function saverRunEnv(m: SaverManifest | undefined, stateDir: string, toolEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const menv = Object.fromEntries(Object.entries(m?.env ?? {}).map(([k, v]) => [k, v.replaceAll("{state}", stateDir)]));
  return { ...saverEnv(stateDir), ...menv, ...toolEnv };
}

/** A temporary folder for the savers' state, with an empty working folder ("empty") in it. */
export function makeStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "saver-audit-"));
  try {
    mkdirSync(join(dir, "empty")); // no project settings to pick up
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return dir;
}

/** Kills a saver process and the processes it started (a wrapper script's worker holds its output pipe). */
function killTree(child: ChildProcess): void {
  try {
    if (process.platform === "win32" || !child.pid) child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL"); // its process group (spawned detached)
  } catch {
    child.kill("SIGKILL");
  }
}

/** Runs one saver process in `cwd`; `live` holds it while it runs. */
export function runOnce(cmd: string, args: string[], input: string, env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number, live: Set<ChildProcess>): Promise<string | undefined> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // Its own process group, so a timeout ends all of it (not on Windows: a new console).
      child = spawn(cmd, args, { env, cwd, stdio: ["pipe", "pipe", "ignore"], detached: process.platform !== "win32" });
    } catch {
      // Refused before starting (e.g. E2BIG: a recorded command over the argument limit).
      return resolve(undefined);
    }
    live.add(child);
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (out: string | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      live.delete(child);
      resolve(out);
    };
    // On a timeout, do not wait for the output pipe to close: a leftover process may hold it.
    const timer = setTimeout(() => {
      killTree(child);
      child.stdout!.destroy();
      finish(undefined);
    }, timeoutMs);
    child.stdout!.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", () => finish(undefined));
    child.on("close", (code) => finish(code === 0 ? Buffer.concat(chunks).toString("utf8") : undefined));
    child.stdin!.on("error", () => {});
    child.stdin!.end(input);
  });
}

/**
 * Runs fn over items with n workers; stops starting new items once `until()` is false.
 * After an error no worker starts a new item, and it throws once all have finished.
 */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>, until: () => boolean = () => true): Promise<number> {
  let i = 0;
  let stop = false;
  const runs = await Promise.allSettled(Array.from({ length: Math.min(n, items.length) }, async () => {
    try {
      while (!stop && i < items.length && until()) await fn(items[i++]!);
    } catch (err) {
      stop = true;
      throw err;
    }
  }));
  const bad = runs.find((r) => r.status === "rejected");
  if (bad) throw bad.reason;
  return i;
}

/**
 * First in every Python program run here: `python -c` puts the current folder first on
 * sys.path, so a headroom/ or json.py where saver-audit is run would be imported.
 */
export const NO_CWD = "import sys; sys.path[:] = [p for p in sys.path if p]";

const HEADROOM_SIDECAR = String.raw`
${NO_CWD}
import json, logging
logging.disable(logging.CRITICAL)
import headroom
from headroom import compress
ready = False
try:
    from headroom.transforms.kompress_compressor import _load_kompress
    _load_kompress(allow_download=False)
    ready = True
except Exception:
    pass
# headroom counts tokens with tiktoken's o200k_base for Claude models; without it cached,
# it would download it (blocked here) and fall back to an estimate.
tokenizer = True
try:
    import tiktoken
    tiktoken.get_encoding("o200k_base")
except Exception:
    tokenizer = False
print(json.dumps({"ready": ready, "tokenizer": tokenizer}), flush=True)
for line in sys.stdin.buffer:
    req = json.loads(line)
    msgs = [{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": req["tool"], "input": {}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": req["text"]}]}]
    try:
        r = compress(msgs, model="claude-sonnet-4-5-20250929")
        out = None
        for m in r.messages:
            if m.get("role") == "user" and isinstance(m.get("content"), list):
                for b in m["content"]:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        c = b.get("content")
                        out = c if isinstance(c, str) else "".join(x.get("text", "") for x in (c or []) if isinstance(x, dict))
        print(json.dumps({"i": req["i"], "out": out}), flush=True)
    except Exception as e:
        print(json.dumps({"i": req["i"], "error": type(e).__name__}), flush=True)
`;

/**
 * JSON with every non-ASCII character escaped, so it reads the same under any code page
 * (on Windows, Python before 3.15 decodes pipes with the ANSI code page, not UTF-8).
 */
function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** One long-lived headroom process; the model loads once, as in a running headroom proxy. */
class HeadroomSidecar {
  readonly child: ChildProcess;
  private closed = false;
  private buf = "";
  private waiting = new Map<number, (out: string | undefined) => void>();
  private next = 0;
  readonly ready: Promise<boolean>;
  /** False when the sidecar reported that headroom's tokenizer vocabulary is not cached. */
  tokenizer?: boolean;

  /** Throws when the program cannot be started at all (see runOnce). */
  constructor(python: string, env: NodeJS.ProcessEnv, cwd: string) {
    const child = spawn(python, ["-u", "-c", HEADROOM_SIDECAR], { env, cwd, stdio: ["pipe", "pipe", "ignore"] });
    this.child = child;
    let resolveReady: (v: boolean) => void = () => {};
    this.ready = new Promise((r) => (resolveReady = r));
    this.child.on("error", () => {
      this.closed = true;
      resolveReady(false);
    });
    this.child.on("close", () => {
      this.closed = true;
      resolveReady(false);
      for (const f of this.waiting.values()) f(undefined);
      this.waiting.clear();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString("utf8");
      for (let nl = this.buf.indexOf("\n"); nl >= 0; nl = this.buf.indexOf("\n")) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if ("ready" in msg) {
          this.tokenizer = msg.tokenizer;
          resolveReady(msg.ready === true);
        } else {
          const f = this.waiting.get(msg.i);
          this.waiting.delete(msg.i);
          f?.(typeof msg.out === "string" ? msg.out : undefined);
        }
      }
    });
    child.stdin.on("error", () => {});
  }

  /** Resolves "timeout" if it takes longer than `ms` (the sidecar is then unusable). */
  compress(tool: string, text: string, ms = Infinity): Promise<string | undefined | "timeout"> {
    if (this.closed) return Promise.resolve(undefined); // it exited: a failed run, not a hang
    const i = this.next++;
    return new Promise((resolve) => {
      const timer = Number.isFinite(ms) ? setTimeout(() => (this.waiting.delete(i), resolve("timeout")), ms) : undefined;
      this.waiting.set(i, (out) => (clearTimeout(timer), resolve(out)));
      this.child.stdin!.write(asciiJson({ i, tool, text }) + "\n");
    });
  }

  /**
   * Stops the sidecar and waits until it has exited: it holds headroom's store in the
   * state folder (on Windows an open file cannot be deleted). SIGKILL after 5 s.
   */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        setTimeout(resolve, 1000);
      }, 5000);
      this.child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.child.stdin!.end();
      this.child.kill();
    });
  }
}

export interface ReplayOptions {
  tools: Map<string, ReplayTool>;
  cacheFile?: string;
  /** Exact mode for all savers (true) or for the listed ones. */
  full: boolean | string[];
  concurrency: number;
  /** Progress lines. */
  log?: (s: string) => void;
  /** Problems the user should see even when progress is shown otherwise (defaults to log). */
  warn?: (s: string) => void;
  progress?: (saver: string, done: number, total: number) => void;
}

/**
 * Resolves the replay jobs left by the workers: runs a deterministic sample of the
 * uncached outputs, caches the results, and extrapolates the rest per output class.
 * Writes the savings into each file's saver blocks.
 */
export async function runReplays(results: FileResult[], saverIds: string[], o: ReplayOptions): Promise<Map<string, ReplayStats>> {
  const stats = new Map<string, ReplayStats>();
  const warn = o.warn ?? o.log;
  const cache = readReplayCache(o.cacheFile);
  const adapters = new Map(saverIndex(saverIds).map((a) => [a.id, a]));
  // Unique outputs per saver; keep a job that carries the text when one does.
  const bySaver = new Map<string, Map<string, ReplayJob>>();
  for (const r of results) {
    for (const j of r.savers?.jobs ?? []) {
      let m = bySaver.get(j.saver);
      if (!m) bySaver.set(j.saver, (m = new Map()));
      const cur = m.get(j.key);
      if (!cur || (!cur.input && j.input)) m.set(j.key, j);
    }
  }
  // The quick sample, drawn from ALL applicable outputs so every run over the same logs
  // uses the same set (a run caches what it replays):
  //  - the largest outputs (half the budget) are always replayed: savings concentrate
  //    there, and a uniform sample misses them (it came out ~30% low for caveman);
  //  - the rest of the budget is a hash-order stratum of the smaller outputs. Unmeasured
  //    outputs are extrapolated from the measured ones in this stratum only (the largest
  //    ones skew per-token ratios, and other cached ones need not be a random sample);
  //  - smaller outputs already cached (e.g. by --exact) use their own result;
  //  - a Claude <persisted-output> preview ranks with the largest: its baseline is the
  //    ~2 KB preview but the saver gets the full output, so it can neither set a ratio
  //    nor be estimated from one.
  // SAVER_AUDIT_STRICT_SAMPLE=1 ignores the cache when choosing (for checking accuracy).
  const strict = process.env.SAVER_AUDIT_STRICT_SAMPLE === "1";
  const sampled = new Map<string, Set<string>>();
  /** Per saver: the outputs extrapolation ratios come from (the stratum, or all when there are no small outputs). */
  const ratioKeys = new Map<string, Set<string> | "all">();
  const smallKeys = new Map<string, string[]>();
  /** Outputs whose replay failed in this run: counted as unchanged, never cached. */
  const failed = new Set<string>();
  /** Why a saver's replays failed, when one cause failed them all (e.g. headroom's model). */
  const failReason = new Map<string, string>();
  // The savers' state folder, made when a replay first needs it.
  let state: string | undefined;
  let noState = false;
  const stateDir = (): string | undefined => {
    if (state || noState) return state;
    try {
      state = makeStateDir();
    } catch (err) {
      noState = true;
      warn?.(`cannot create a temporary folder (${(err as NodeJS.ErrnoException).code ?? "error"}); saver replays skipped.`);
    }
    return state;
  };
  // Cache writes are best effort: warn once, keep going.
  let saveError: string | undefined;
  const save = () => {
    if (!o.cacheFile || saveError) return;
    saveError = saveReplayCache(o.cacheFile, cache);
    if (saveError) warn?.(`replay cache not saved (${saveError}); these outputs will be replayed again next run.`);
  };
  let dirty = false;
  // Ctrl+C or a kill: stop the savers and remove their state folder (it holds copies of
  // tool output), then end the way the signal would have.
  const live = new Set<ChildProcess>();
  const onSignal = (sig: NodeJS.Signals) => {
    for (const c of live) killTree(c);
    try {
      if (state) rmSync(state, { recursive: true, force: true });
    } catch {
      // nothing more to do on the way out
    }
    process.kill(process.pid, sig);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  // Savers run at the same time; each has its own time budget in quick mode.
  const one = async (saver: string, unique: Map<string, ReplayJob>): Promise<void> => {
      const tool = o.tools.get(saver);
      const keys = [...unique.keys()].sort();
      const exact = o.full === true || (Array.isArray(o.full) && o.full.includes(saver));
      const budget = quickBudget(saver);
      const size = (k: string) => (unique.get(k)!.persistedHeader !== undefined ? Infinity : unique.get(k)!.baseline);
      const bySize = [...keys].sort((a, b) => size(b) - size(a) || (a < b ? -1 : 1));
      const large = bySize.slice(0, Math.ceil(budget / 2));
      const inLarge = new Set(large);
      const small = keys.filter((k) => !inLarge.has(k));
      const stratum = small.slice(0, budget - large.length);
      // Exact mode replays everything in the same order, the quick sample first, so an
      // interrupted exact run leaves a sample quick mode can extrapolate from.
      const sample = exact ? [...large, ...small] : [...large, ...small.filter((k, n) => n < stratum.length || (!strict && cache.has(k)))];
      sampled.set(saver, new Set(sample));
      ratioKeys.set(saver, small.length ? new Set(stratum) : "all");
      smallKeys.set(saver, small);
      const uncached = keys.filter((k) => !cache.has(k) && unique.get(k)!.input).length;
      const st: ReplayStats = { total: keys.length, pending: uncached, ran: 0, extrapolated: 0, failed: 0 };
      stats.set(saver, st);
      const todo = sample.filter((k) => !cache.has(k) && unique.get(k)!.input);
      if (!tool || !todo.length) return;
      // Quick mode has a clock: no new replays after the budget; outputs not reached are
      // extrapolated like the rest (and stay "indicative").
      let deadline = exact ? Infinity : Date.now() + quickSeconds(saver) * 1000;
      const inTime = () => Date.now() < deadline;
      const store = (key: string, out: string | undefined, counted?: ReplayResult) => {
        if (counted) cache.set(key, counted);
        else if (out !== undefined) cache.set(key, { t: countProxy(out), c: out.length, p: countProxy(out.slice(0, PREVIEW_CHARS)) });
        else {
          // A failed run is never cached, so the next run (or a fixed saver) tries again;
          // in this run the output counts as unchanged.
          st.failed++;
          failed.add(key);
        }
        st.ran++;
        st.pending = Math.max(0, st.pending - 1);
        dirty ||= out !== undefined || !!counted;
        o.progress?.(saver, st.ran, todo.length);
        // Long replays save as they go, so an interrupted run resumes where it stopped.
        if (st.ran % CHECKPOINT === 0) {
          save();
          o.log?.(`  ${saver}: ${st.ran.toLocaleString("en-US")} of ${todo.length.toLocaleString("en-US")} replayed`);
        }
      };
      // Cache-only savers in quick mode (budget 0): use what an exact run cached, if anything.
      if (!exact && quickSeconds(saver) === 0) return;
      // Every output left counts as failed when one cause stops them all.
      const failAll = (reason: string) => {
        for (const k of todo) failed.add(k);
        st.failed += todo.length;
        st.pending = Math.max(0, st.pending - todo.length);
        failReason.set(saver, reason);
      };
      const dir = stateDir();
      if (!dir) return failAll("no temporary folder");
      o.log?.(`replaying ${todo.length.toLocaleString("en-US")} new outputs through ${saver} (results are cached for next time)…`);
      const env = saverEnv(dir);
      if (saver === "headroom") {
        let side: HeadroomSidecar;
        try {
          side = new HeadroomSidecar(tool.command, { ...env, ...tool.env, HEADROOM_WORKSPACE_DIR: join(dir, "headroom") }, join(dir, "empty"));
        } catch (err) {
          // Refused before starting: ENOEXEC, or EBADMACHO for a program built for another CPU.
          failAll("its Python could not start");
          warn?.(`headroom: its Python could not start (${(err as NodeJS.ErrnoException).code ?? "error"}); skipped.`);
          return;
        }
        live.add(side.child);
        try {
          // The installer's own headroom is finished by the installer; another runs once online.
          const ours = tool.command === toolPaths.headroomPython();
          const fix = (other: string) => (ours ? "finish its install with: npx saver-audit --install-savers --with-headroom" : other);
          if (!(await side.ready)) {
            failAll("compression model not cached");
            warn?.(`headroom: its compression model is not cached; skipped (${fix("run headroom once online to download it")}).`);
            return;
          }
          if (side.tokenizer === false) {
            failAll("tokenizer not cached");
            warn?.(`headroom: its tokenizer (tiktoken's o200k_base) is not cached, and an audit never downloads it; skipped (${fix("run headroom once online")}).`);
            return;
          }
          for (const key of todo) {
            if (!inTime()) break;
            const j = unique.get(key)!;
            const out = await side.compress(j.tool, j.input, exact ? Infinity : Math.max(1000, deadline - Date.now()));
            if (out === "timeout") break; // not cached: it was not measured
            store(key, out);
          }
        } finally {
          await side.close();
          live.delete(side.child);
        }
      } else {
        const m = adapters.get(saver)?.manifest;
        const runEnv = saverRunEnv(m, dir, tool.env);
        const ratio = m?.jsonRatio;
        await pool(todo, WAIT_BOUND.has(saver) ? o.concurrency * 3 : o.concurrency, async (key) => {
          const j = unique.get(key)!;
          const out = await runOnce(tool.command, j.args ?? [], j.input, runEnv, join(dir, "empty"), 60_000, live);
          if (!ratio || out === undefined) return store(key, out);
          // The program reports its own before/after counts: apply its ratio to our count.
          const r = ratioResult(out, ratio, countProxy(j.input));
          store(key, r ? "" : undefined, r);
        }, inTime);
      }
  };
  try {
    // One saver at a time, fastest first: in parallel they only compete for the same cores.
    const order = [...bySaver].sort(([a], [b]) => (RATE[b] ?? DEFAULT_RATE) - (RATE[a] ?? DEFAULT_RATE));
    for (const [saver, unique] of order) await one(saver, unique);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    try {
      if (state) rmSync(state, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      warn?.(`could not remove the savers' temporary folder ${state}`);
    }
  }
  // More failed than measured: a number would be mostly failures counted as unchanged.
  for (const [saver, st] of stats) {
    if (!st.failed) continue;
    const measured = [...sampled.get(saver)!].filter((k) => cache.has(k)).length;
    if (st.failed > measured) Object.assign(st, { insufficient: true, reason: failReason.get(saver) ?? (measured ? "most replays failed" : "every replay failed") });
  }
  if (dirty) save();

  // Measured outputs get their replayed result; the rest are extrapolated per class.
  const idx = new Map(saverIds.map((id, i) => [id, i]));
  const ratios = new Map<string, { saved: number; base: number }>();
  const basis = new Map<string, Set<string>>();
  const pending: Array<[FileResult, ReplayJob]> = [];
  for (const r of results) {
    for (const j of r.savers?.jobs ?? []) {
      if (failed.has(j.key)) continue; // unchanged: d stays 0
      const hit = sampled.get(j.saver)?.has(j.key) ? cache.get(j.key) : undefined;
      if (!hit) {
        pending.push([r, j]);
        continue;
      }
      const d = j.baseline - presentedTokens(hit, j);
      r.savers!.timelines[j.timeline]!.blocks[j.block]!.d[idx.get(j.saver)!] = d;
      const from = ratioKeys.get(j.saver);
      if (j.persistedHeader !== undefined || (from !== "all" && !from?.has(j.key))) continue;
      for (const cls of [`${j.saver}|${j.cls}`, `${j.saver}|*`]) {
        const a = ratios.get(cls) ?? { saved: 0, base: 0 };
        a.saved += d;
        a.base += j.baseline;
        ratios.set(cls, a);
      }
      let b = basis.get(j.saver);
      if (!b) basis.set(j.saver, (b = new Set()));
      b.add(j.key);
    }
  }
  const ratioFor = (j: ReplayJob) => {
    const a = ratios.get(`${j.saver}|${j.cls}`) ?? ratios.get(`${j.saver}|*`);
    return a && a.base > 0 ? a.saved / a.base : undefined;
  };
  // Measured smaller outputs that are exactly the larger ones (a cache left by an exact run
  // from an earlier release, stopped part-way: it went largest first) are not a sample.
  const sizeCut = (saver: string) => {
    const unique = bySaver.get(saver)!;
    let measured = Infinity;
    let rest = -Infinity;
    for (const k of smallKeys.get(saver) ?? []) {
      if (failed.has(k)) continue;
      const b = unique.get(k)!.baseline;
      if (sampled.get(saver)!.has(k) && cache.has(k)) measured = Math.min(measured, b);
      else rest = Math.max(rest, b);
    }
    return measured !== Infinity && rest !== -Infinity && measured > rest;
  };
  // Once per saver: it walks all of the saver's outputs.
  const cut = new Map([...bySaver.keys()].map((saver) => [saver, sizeCut(saver)]));
  // Too few measured outputs to extrapolate from: no number rather than a guess.
  for (const [, j] of pending) {
    const st = o.tools.has(j.saver) ? stats.get(j.saver) : undefined;
    if (!st || st.insufficient) continue;
    const guess = j.persistedHeader === undefined && (basis.get(j.saver)?.size ?? 0) >= MIN_QUICK_SAMPLE && ratioFor(j) !== undefined;
    if (!guess) Object.assign(st, { insufficient: true, reason: QUICK_REASON });
    else if (cut.get(j.saver)) Object.assign(st, { insufficient: true, reason: "cached results hold only the larger outputs, not a sample" });
  }
  const extrapolated = new Map<string, Set<string>>();
  for (const [r, j] of pending) {
    const st = o.tools.has(j.saver) ? stats.get(j.saver) : undefined;
    if (!st || st.insufficient) continue;
    r.savers!.timelines[j.timeline]!.blocks[j.block]!.d[idx.get(j.saver)!] = ratioFor(j)! * j.baseline;
    let e = extrapolated.get(j.saver);
    if (!e) extrapolated.set(j.saver, (e = new Set()));
    e.add(j.key);
  }
  for (const [saver, st] of stats) st.extrapolated = st.insufficient ? 0 : (extrapolated.get(saver)?.size ?? 0);
  for (const r of results) if (r.savers) r.savers.jobs = [];
  return stats;
}

export type { ReplayResult };

/** Reads a saver's own before/after counts from its JSON output and scales our count. */
export function ratioResult(out: string, f: { before: string; after: string; afterBytes?: string }, ourTokens: number): ReplayResult | undefined {
  try {
    const j = JSON.parse(out);
    const before = Number(j?.[f.before]);
    const after = Number(j?.[f.after]);
    if (!(before > 0) || !(after >= 0)) return undefined;
    const t = Math.round((ourTokens * after) / before);
    const bytes = f.afterBytes !== undefined ? Number(j?.[f.afterBytes]) : NaN;
    const c = Number.isFinite(bytes) && bytes >= 0 ? bytes : t * 4;
    return { t, c, p: c > 0 ? Math.round(t * Math.min(1, PREVIEW_CHARS / c)) : t };
  } catch {
    return undefined;
  }
}
