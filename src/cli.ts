// saver-audit: where your Claude Code and Codex tokens go. Offline by default.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { parseArgs } from "node:util";
import { runAudit, runWorker, defaultJobs, defaultReplayCachePath, WORKER_FLAG } from "./pool.ts";
import { SAVERS, saverIndex } from "./savers/registry.ts";
import { claudeRoots } from "./sources/claude-code.ts";
import { codexHome } from "./sources/codex.ts";
import { loadPrices, userPricesPath } from "./prices/load.ts";
import { renderTerminal } from "./report/terminal.ts";
import { renderJson } from "./report/json.ts";
import type { Source } from "./sources/types.ts";
import { parsePeriod, parseUntil } from "./period.ts";
import { normalizeCardArg } from "./args.ts";
import { VERSION } from "./version.ts";


const HELP = `saver-audit — where your Claude Code and Codex tokens really go

Usage: saver-audit [options]

  --last <N>d|w|h        period to audit (default 30d)
  --since <YYYY-MM-DD>   start date instead of --last
  --until <YYYY-MM-DD>   end date (default: now)
  --source <s>           claude-code | codex | all (default all)
  --json                 machine-readable output
  --card [path]          write a share card PNG (default saver-audit.png)
  --show-projects        include project names (hidden by default)
  --savers <a,b>         savers to audit (default: all; see list below)
  --no-savers            skip the saver section
  --full-replay          replay every output instead of a sample (slow first run; cached)
  --update-prices        fetch a fresh public price list (the only network call)
  --verbose              more detail about skipped records
  -h, --help / -v, --version

Savers: rtk, caveman-engine, headroom (replayed on your installed copies),
caveman-skill (modeled), codegraph, context-mode (upper bounds).

Reads ~/.claude/projects and ~/.codex/sessions locally. Nothing leaves your machine.
Dollar figures are API-equivalent list prices, not a subscription bill.
`;

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: normalizeCardArg(argv),
    options: {
      last: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      source: { type: "string", default: "all" },
      json: { type: "boolean", default: false },
      card: { type: "string" },
      "show-projects": { type: "boolean", default: false },
      "update-prices": { type: "boolean", default: false },
      savers: { type: "string" },
      "no-savers": { type: "boolean", default: false },
      "full-replay": { type: "boolean", default: false },
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
  const saverIds = values["no-savers"] ? [] : values.savers ? values.savers.split(",").map((x) => x.trim()).filter(Boolean) : SAVERS.map((x) => x.id);

  const src = values.source;
  if (src !== "all" && src !== "claude-code" && src !== "codex") throw new Error(`--source: expected claude-code, codex or all, got ${src}`);
  const sources: Source[] = src === "all" ? ["claude-code", "codex"] : [src];
  const now = Date.now();
  const t0 = performance.now();
  const result = await runAudit(
    { sinceMs: parsePeriod(values.last, values.since, now), untilMs: parseUntil(values.until, now), sources, claudeRoots: claudeRoots(), codexHome: codexHome(), prices: loadPrices() },
    new URL(import.meta.url),
    values.jobs ? Math.max(1, Number(values.jobs)) : defaultJobs(),
    { ids: saverIndex(saverIds).map((x) => x.id), full: values["full-replay"], cacheFile: defaultReplayCachePath(), log },
  );
  const showProjects = values["show-projects"];
  if (values.card !== undefined) {
    const { writeCard } = await import("./report/card.ts");
    await writeCard(result, values.card);
    log(`share card written to ${values.card} (numbers, model names and dates only)`);
  }
  if (values.json) process.stdout.write(renderJson(result, { showProjects, version: VERSION }));
  else process.stdout.write(renderTerminal(result, { showProjects, verbose: values.verbose, color: (process.stdout.isTTY === true || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR, elapsedMs: performance.now() - t0 }));
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
