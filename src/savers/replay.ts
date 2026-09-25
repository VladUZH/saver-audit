// Runs replayed savers on the user's own installed binaries (main thread).
// Never bundles saver code (CLAUDE.md non-negotiable 6); a saver that is not
// installed is skipped with a note. Every saver runs with telemetry off and its
// state in a temporary folder.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { countProxy } from "../accounting/tokens.ts";
import type { FileResult } from "../audit.ts";
import { readReplayCache, saveReplayCache } from "./cache.ts";
import { presentedTokens, PREVIEW_CHARS, type ReplayResult } from "./tracker.ts";
import type { ReplayJob } from "./types.ts";
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
  /** Unique outputs replayed in this run (not from cache). */
  ran: number;
  /** Unique outputs left to extrapolation because of the sample budget. */
  extrapolated: number;
  failed: number;
}

/** Default number of unique outputs replayed per run and saver; --full-replay lifts it. */
const CHECKPOINT = 250;

// rtk and the caveman engine are replayed in full above their size floor (cheap and
// exact; sampling missed caveman's rare, spiky savings by up to 40%). headroom runs an
// ML model per output, so it stays a size-stratified sample unless --full-replay.
export const DEFAULT_BUDGET: Record<string, number> = { rtk: Infinity, "caveman-engine": Infinity, "token-saver": Infinity, "lean-ctx": Infinity, headroom: 300 };
/** Other savers: a size-stratified sample unless --full-replay (checked per saver, tech-notes §8.10). */
const COMMUNITY_BUDGET = 1000;
/** Savers that mostly wait (interpreter start-up) run more processes than cores. */
const WAIT_BOUND = new Set(["token-saver", "lean-ctx"]);

function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, name);
    if (dir && existsSync(p)) return p;
  }
  return undefined;
}

function firstLine(cmd: string, args: string[]): string | undefined {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000, env: saverEnv("") });
  const out = `${r.stdout ?? ""}`.trim().split("\n")[0];
  return r.status === 0 && out ? out : undefined;
}

/**
 * Finds the installed saver binaries: explicit overrides, then your PATH (your own
 * installs), then the folder --install-savers uses. Missing tools are simply absent.
 */
export function detectReplayTools(savers: SaverAdapter[] = allSavers().savers): Map<string, ReplayTool> {
  const found = new Map<string, ReplayTool>();
  const exists = (p: string) => (existsSync(p) ? p : undefined);
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const s of savers) {
    const m = s.manifest;
    if (!m || m.method !== "replayed" || !m.binary) continue;
    const extra = (m.paths ?? []).map((p) => join(p.replace(/^~(?=\/|$)/, homedir()), m.binary + exe));
    const command =
      (m.binaryEnv ? process.env[m.binaryEnv] : undefined) ??
      onPath(m.binary + exe) ??
      exists(join(toolsDir(), "bin", m.binary + exe)) ??
      extra.find((p) => existsSync(p));
    if (!command) continue;
    const version = m.versionArgs ? firstLine(command, m.versionArgs)?.replace(new RegExp(`^${m.binary}\\s+`), "") : undefined;
    found.set(s.id, { saver: s.id, command, version });
  }
  const own = process.env.SAVER_AUDIT_HEADROOM_PYTHON ?? headroomPython();
  const ours = own ? undefined : exists(toolPaths.headroomPython());
  const py = own ?? ours;
  if (py) {
    const v = firstLine(py, ["-c", "import headroom; print(getattr(headroom, '__version__', 'unknown'))"]);
    const env = ours ? { HF_HOME: toolPaths.hfHome() } : undefined;
    if (v) found.set("headroom", { saver: "headroom", command: py, version: v, env });
  }
  return found;
}

/** The Python interpreter behind an installed `headroom` command (uv/pipx shebang). */
function headroomPython(): string | undefined {
  const cli = onPath("headroom");
  if (!cli) return undefined;
  try {
    const shebang = readFileSync(cli, "utf8").split("\n", 1)[0] ?? "";
    const m = /^#!\s*(\S+python[\d.]*)\s*$/.exec(shebang);
    return m && existsSync(m[1]!) ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

function saverEnv(stateDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DO_NOT_TRACK: "1",
    HEADROOM_BEACON: "off",
    HEADROOM_OFFLINE: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    ...(stateDir ? { CAVEMAN_HOME: join(stateDir, "caveman"), HEADROOM_WORKSPACE_DIR: join(stateDir, "headroom") } : {}),
  };
}

function runOnce(cmd: string, args: string[], input: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? Buffer.concat(chunks).toString("utf8") : undefined);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

const HEADROOM_SIDECAR = String.raw`
import sys, json, logging
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
print(json.dumps({"ready": ready}), flush=True)
for line in sys.stdin:
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

/** One long-lived headroom process; the model loads once, as in a running headroom proxy. */
class HeadroomSidecar {
  private child;
  private buf = "";
  private waiting = new Map<number, (out: string | undefined) => void>();
  private next = 0;
  readonly ready: Promise<boolean>;

  constructor(python: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(python, ["-u", "-c", HEADROOM_SIDECAR], { env, stdio: ["pipe", "pipe", "ignore"] });
    let resolveReady: (v: boolean) => void = () => {};
    this.ready = new Promise((r) => (resolveReady = r));
    this.child.on("error", () => resolveReady(false));
    this.child.on("close", () => {
      resolveReady(false);
      for (const f of this.waiting.values()) f(undefined);
      this.waiting.clear();
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
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
        if ("ready" in msg) resolveReady(msg.ready === true);
        else {
          const f = this.waiting.get(msg.i);
          this.waiting.delete(msg.i);
          f?.(typeof msg.out === "string" ? msg.out : undefined);
        }
      }
    });
    this.child.stdin.on("error", () => {});
  }

  compress(tool: string, text: string): Promise<string | undefined> {
    const i = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(i, resolve);
      this.child.stdin.write(JSON.stringify({ i, tool, text }) + "\n");
    });
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

export interface ReplayOptions {
  tools: Map<string, ReplayTool>;
  cacheFile?: string;
  full: boolean;
  concurrency: number;
  log?: (s: string) => void;
  progress?: (saver: string, done: number, total: number) => void;
}

/**
 * Resolves the replay jobs left by the workers: runs a deterministic sample of the
 * uncached outputs, caches the results, and extrapolates the rest per output class.
 * Writes the savings into each file's saver blocks.
 */
export async function runReplays(results: FileResult[], saverIds: string[], o: ReplayOptions): Promise<Map<string, ReplayStats>> {
  const stats = new Map<string, ReplayStats>();
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
  // The sample, drawn from ALL applicable outputs so every run over the same logs uses
  // the same set (a run caches what it replays):
  //  - the largest outputs (half the budget) are always replayed: savings concentrate
  //    there, and a uniform sample misses them (it came out ~30% low for caveman);
  //  - the rest of the budget is a hash-order sample of the smaller outputs, plus any
  //    already cached (e.g. by --full-replay). Only small outputs are extrapolated,
  //    from the small ones that were replayed.
  // SAVER_AUDIT_STRICT_SAMPLE=1 ignores the cache when choosing (for checking accuracy).
  const strict = process.env.SAVER_AUDIT_STRICT_SAMPLE === "1";
  const sampled = new Map<string, Set<string>>();
  const smallSampled = new Map<string, Set<string>>();
  const state = mkdtempSync(join(tmpdir(), "saver-audit-"));
  const env = saverEnv(state);
  let dirty = false;
  try {
    for (const [saver, unique] of bySaver) {
      const tool = o.tools.get(saver);
      const keys = [...unique.keys()].sort();
      const budget = o.full ? Infinity : DEFAULT_BUDGET[saver] ?? COMMUNITY_BUDGET;
      const bySize = [...keys].sort((a, b) => unique.get(b)!.baseline - unique.get(a)!.baseline || (a < b ? -1 : 1));
      const large = new Set(bySize.slice(0, Math.ceil(budget / 2)));
      const small = keys.filter((k) => !large.has(k));
      const smallBudget = budget - large.size;
      const smallSample = small.filter((k, n) => n < smallBudget || (!strict && cache.has(k)));
      const sample = [...large, ...smallSample];
      sampled.set(saver, new Set(sample));
      smallSampled.set(saver, new Set(smallSample));
      const st: ReplayStats = { total: keys.length, ran: 0, extrapolated: keys.length - sample.length, failed: 0 };
      stats.set(saver, st);
      const todo = sample.filter((k) => !cache.has(k) && unique.get(k)!.input);
      if (!tool || !todo.length) continue;
      o.log?.(`replaying ${todo.length.toLocaleString("en-US")} new outputs through ${saver} (results are cached for next time)…`);
      const store = (key: string, out: string | undefined, counted?: ReplayResult) => {
        if (counted) cache.set(key, counted);
        else {
          if (out === undefined) {
            // A failed run is recorded as a pass-through (what caveman and rtk do on
            // error), so the result is stable across runs.
            st.failed++;
            out = unique.get(key)!.input;
          }
          cache.set(key, { t: countProxy(out), c: out.length, p: countProxy(out.slice(0, PREVIEW_CHARS)) });
        }
        st.ran++;
        dirty = true;
        o.progress?.(saver, st.ran, todo.length);
        // Long replays save as they go, so an interrupted run resumes where it stopped.
        if (st.ran % CHECKPOINT === 0) {
          if (o.cacheFile) saveReplayCache(o.cacheFile, cache);
          o.log?.(`  ${saver}: ${st.ran.toLocaleString("en-US")} of ${todo.length.toLocaleString("en-US")} replayed`);
        }
      };
      if (saver === "headroom") {
        const side = new HeadroomSidecar(tool.command, { ...env, ...tool.env, HEADROOM_WORKSPACE_DIR: join(state, "headroom") });
        if (!(await side.ready)) {
          side.close();
          st.failed = todo.length;
          o.log?.("headroom: its compression model is not cached; skipped (run headroom once online to download it).");
          continue;
        }
        for (const key of todo) {
          const j = unique.get(key)!;
          store(key, await side.compress(j.tool, j.input));
        }
        side.close();
      } else {
        const m = adapters.get(saver)?.manifest;
        // The manifest's environment; "{state}" is this run's temporary state folder.
        const menv = Object.fromEntries(Object.entries(m?.env ?? {}).map(([k, v]) => [k, v.replaceAll("{state}", state)]));
        const runEnv = { ...env, ...menv, ...tool.env };
        const ratio = m?.jsonRatio;
        await pool(todo, WAIT_BOUND.has(saver) ? o.concurrency * 3 : o.concurrency, async (key) => {
          const j = unique.get(key)!;
          const out = await runOnce(tool.command, j.args ?? [], j.input, runEnv, 60_000);
          if (!ratio || out === undefined) return store(key, out);
          // The program reports its own before/after counts: apply its ratio to our count.
          const r = ratioResult(out, ratio, countProxy(j.input));
          store(key, r ? "" : undefined, r);
        });
      }
    }
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
  if (dirty && o.cacheFile) saveReplayCache(o.cacheFile, cache);

  // Sampled outputs get their replayed result; the rest are extrapolated per class.
  const idx = new Map(saverIds.map((id, i) => [id, i]));
  const ratios = new Map<string, { saved: number; base: number }>();
  const pending: Array<[FileResult, ReplayJob]> = [];
  for (const r of results) {
    for (const j of r.savers?.jobs ?? []) {
      const hit = sampled.get(j.saver)?.has(j.key) ? cache.get(j.key) : undefined;
      if (!hit) {
        pending.push([r, j]);
        continue;
      }
      const d = j.baseline - presentedTokens(hit, j);
      r.savers!.timelines[j.timeline]!.blocks[j.block]!.d[idx.get(j.saver)!] = d;
      // Extrapolation ratios come from the replayed small outputs only (unsampled
      // outputs are all small); the large ones are exact and skew per-token ratios.
      if (!smallSampled.get(j.saver)?.has(j.key)) continue;
      for (const cls of [`${j.saver}|${j.cls}`, `${j.saver}|*`]) {
        const a = ratios.get(cls) ?? { saved: 0, base: 0 };
        a.saved += d;
        a.base += j.baseline;
        ratios.set(cls, a);
      }
    }
  }
  for (const [r, j] of pending) {
    if (!o.tools.has(j.saver)) continue;
    const a = ratios.get(`${j.saver}|${j.cls}`) ?? ratios.get(`${j.saver}|*`);
    if (a && a.base > 0) r.savers!.timelines[j.timeline]!.blocks[j.block]!.d[idx.get(j.saver)!] = (a.saved / a.base) * j.baseline;
  }
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
