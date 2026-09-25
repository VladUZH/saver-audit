// saver-audit: where your Claude Code and Codex tokens go. Offline by default.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { parseArgs } from "node:util";
import { runAudit, runWorker, defaultJobs, WORKER_FLAG } from "./pool.ts";
import { claudeRoots } from "./sources/claude-code.ts";
import { codexHome } from "./sources/codex.ts";
import { loadPrices, userPricesPath } from "./prices/load.ts";
import { renderTerminal } from "./report/terminal.ts";
import { renderJson } from "./report/json.ts";
import type { Source } from "./sources/types.ts";
import { parsePeriod } from "./period.ts";

export const VERSION = "0.0.0";

const HELP = `saver-audit — where your Claude Code and Codex tokens really go

Usage: saver-audit [options]

  --last <N>d|w|h        period to audit (default 30d)
  --since <YYYY-MM-DD>   start date instead of --last
  --source <s>           claude-code | codex | all (default all)
  --json                 machine-readable output
  --show-projects        include project names (hidden by default)
  --update-prices        fetch a fresh public price list (the only network call)
  --verbose              more detail about skipped records
  -h, --help / -v, --version

Reads ~/.claude/projects and ~/.codex/sessions locally. Nothing leaves your machine.
Dollar figures are API-equivalent list prices, not a subscription bill.
`;

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      last: { type: "string" },
      since: { type: "string" },
      source: { type: "string", default: "all" },
      json: { type: "boolean", default: false },
      card: { type: "string" },
      "show-projects": { type: "boolean", default: false },
      "update-prices": { type: "boolean", default: false },
      savers: { type: "string" },
      verbose: { type: "boolean", default: false },
      jobs: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const log = (s: string) => process.stderr.write(s + "\n");
  if (values["update-prices"]) {
    const { updatePrices } = await import("./prices/update.ts");
    await updatePrices(userPricesPath(), log);
  }
  if (values.card !== undefined || values.savers !== undefined) log("note: --card and --savers are not built yet (milestones M2/M3).");

  const src = values.source;
  if (src !== "all" && src !== "claude-code" && src !== "codex") throw new Error(`--source: expected claude-code, codex or all, got ${src}`);
  const sources: Source[] = src === "all" ? ["claude-code", "codex"] : [src];
  const now = Date.now();
  const t0 = performance.now();
  const result = await runAudit(
    { sinceMs: parsePeriod(values.last, values.since, now), untilMs: now, sources, claudeRoots: claudeRoots(), codexHome: codexHome(), prices: loadPrices() },
    new URL(import.meta.url),
    values.jobs ? Math.max(1, Number(values.jobs)) : defaultJobs(),
  );
  const showProjects = values["show-projects"];
  if (values.json) process.stdout.write(renderJson(result, { showProjects, version: VERSION }));
  else process.stdout.write(renderTerminal(result, { showProjects, verbose: values.verbose, color: process.stdout.isTTY === true && !process.env.NO_COLOR, elapsedMs: performance.now() - t0 }));
  return 0;
}

if (!isMainThread && workerData?.[WORKER_FLAG]) {
  runWorker(parentPort!);
} else if (isMainThread) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err: unknown) => {
      process.stderr.write(`saver-audit: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
