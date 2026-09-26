// Parses files in parallel with worker threads. Tokenizing is most of the work
// (tech-notes §8.3), and files are independent until dedupe, so this scales with cores.
import { statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { findFiles, processFile, summarize, type AuditOptions, type AuditResult, type FileResult, type SaverConfig } from "./audit.ts";
import { saverIndex } from "./savers/registry.ts";
import { detectReplayTools, runReplays, type ReplayTool } from "./savers/replay.ts";
import { defaultReplayCachePath } from "./savers/cache.ts";
import type { Source } from "./sources/types.ts";

export const WORKER_FLAG = "saver-audit-worker";

interface Job {
  file: string;
  source: Source;
  index: number;
  savers?: SaverConfig;
}

/**
 * Runs processFile over all files. `entry` is the URL of a module that calls
 * runWorker() when started as a worker (the CLI bundle itself).
 */
export type Progress = (done: number, total: number) => void;

export async function processAll(files: Array<{ file: string; source: Source }>, entry: URL | undefined, jobs: number, savers?: SaverConfig, progress?: Progress): Promise<FileResult[]> {
  const results: FileResult[] = new Array(files.length);
  const queue: Job[] = files.map((f, index) => ({ ...f, index, savers }));
  let done = 0;
  progress?.(0, files.length);
  if (!entry || jobs <= 1 || files.length < 2) {
    for (const j of queue) {
      results[j.index] = await processFile(j.file, j.source, j.index, j.savers);
      progress?.(++done, files.length);
    }
    return results;
  }
  // Largest files first, so one big file does not finish last on its own.
  const size = (f: string) => {
    try {
      return statSync(f).size;
    } catch {
      return 0;
    }
  };
  const sizes = new Map(queue.map((j) => [j.index, size(j.file)]));
  queue.sort((a, b) => sizes.get(b.index)! - sizes.get(a.index)!);

  const n = Math.min(jobs, files.length);
  await Promise.all(
    Array.from({ length: n }, () =>
      new Promise<void>((resolve, reject) => {
        const w = new Worker(entry, { workerData: { [WORKER_FLAG]: true } });
        const next = () => {
          const job = queue.shift();
          if (job) w.postMessage(job);
          else void w.terminate().then(() => resolve());
        };
        w.on("message", (r: FileResult & { index: number }) => {
          results[r.index] = r;
          progress?.(++done, files.length);
          next();
        });
        w.on("error", reject);
        next();
      }),
    ),
  );
  return results;
}

export function defaultJobs(): number {
  return Math.max(1, Math.min(availableParallelism() - 1, 16));
}

/** Worker side: parse each file it is sent and post the result back. */
export function runWorker(port: { on(ev: "message", f: (j: Job) => void): void; postMessage(v: unknown): void }): void {
  port.on("message", async (job: Job) => {
    const r = await processFile(job.file, job.source, job.index, job.savers);
    port.postMessage({ ...r, index: job.index });
  });
}

export interface SaverOptions {
  /** Saver ids to audit; empty = none. */
  ids: string[];
  /** Exact mode: replay every output (above the size floors) for all savers, or for the listed ones. */
  full?: boolean | string[];
  /** Replay cache file; undefined disables the cache. */
  cacheFile?: string;
  /** Installed saver binaries; detected when undefined. */
  tools?: Map<string, ReplayTool>;
  log?: (s: string) => void;
}

export interface RunHooks {
  /** Log files parsed so far. */
  files?: Progress;
  /** Outputs replayed so far, per saver. */
  replay?: (saver: string, done: number, total: number) => void;
}

export async function runAudit(opts: AuditOptions, entry?: URL, jobs = defaultJobs(), saverOpts?: SaverOptions, hooks: RunHooks = {}): Promise<AuditResult> {
  const ids = saverOpts?.ids ?? [];
  if (!ids.length) return summarize(opts, await processAll(findFiles(opts), entry, jobs, undefined, hooks.files));
  const savers = saverIndex(ids);
  const tools = saverOpts?.tools ?? detectReplayTools();
  const config: SaverConfig = {
    ids: savers.map((s) => s.id),
    replayable: savers.filter((s) => s.method === "replayed" && tools.has(s.id)).map((s) => s.id),
    cacheFile: saverOpts?.cacheFile,
    until: new Date(opts.untilMs).toISOString(),
    versions: Object.fromEntries([...tools].flatMap(([id, t]) => (t.version ? [[id, t.version]] : []))),
  };
  const results = await processAll(findFiles(opts), entry, jobs, config, hooks.files);
  const stats = await runReplays(results, config.ids, { tools, cacheFile: config.cacheFile, full: saverOpts?.full ?? false, concurrency: Math.max(1, jobs), log: saverOpts?.log, progress: hooks.replay });
  return summarize(opts, results, { savers, tools, stats });
}

export { defaultReplayCachePath };
