// Parses files in parallel with worker threads. Tokenizing is most of the work
// (tech-notes §8.3), and files are independent until dedupe, so this scales with cores.
import { statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { findFiles, processFile, summarize, type AuditOptions, type AuditResult, type FileResult } from "./audit.ts";
import type { Source } from "./sources/types.ts";

export const WORKER_FLAG = "saver-audit-worker";

interface Job {
  file: string;
  source: Source;
  index: number;
}

/**
 * Runs processFile over all files. `entry` is the URL of a module that calls
 * runWorker() when started as a worker (the CLI bundle itself).
 */
export async function processAll(files: Array<{ file: string; source: Source }>, entry: URL | undefined, jobs: number): Promise<FileResult[]> {
  const results: FileResult[] = new Array(files.length);
  const queue: Job[] = files.map((f, index) => ({ ...f, index }));
  if (!entry || jobs <= 1 || files.length < 2) {
    for (const j of queue) results[j.index] = await processFile(j.file, j.source, j.index);
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
    const r = await processFile(job.file, job.source, job.index);
    port.postMessage({ ...r, index: job.index });
  });
}

export async function runAudit(opts: AuditOptions, entry?: URL, jobs = defaultJobs()): Promise<AuditResult> {
  return summarize(opts, await processAll(findFiles(opts), entry, jobs));
}
