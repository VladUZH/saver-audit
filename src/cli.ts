// saver-audit: where your Claude Code and Codex tokens go. Offline by default.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { parseArgs } from "node:util";
import { runAudit, runWorker, defaultJobs, defaultReplayCachePath, WORKER_FLAG } from "./pool.ts";
import { SAVERS, saverIndex } from "./savers/registry.ts";
import { claudeRoots } from "./sources/claude-code.ts";
import { codexHome } from "./sources/codex.ts";
import { loadPrices, userPricesPath } from "./prices/load.ts";
import { renderShort, renderTerminal } from "./report/terminal.ts";
import { canAnimate, keyMenu, reveal, Spinner } from "./report/present.ts";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
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
  --full                 print the full report (default in a terminal: a short one,
                         with a key for the full report, sharing and the card)
  --short                print only the short report (no key menu)
  --json                 machine-readable output
  --card [path]          share card path (written by default in a terminal as
                         saver-audit.png; elsewhere only with --card)
  --no-card              don't write the share card
  --no-animation         print at once instead of line by line
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
      "no-card": { type: "boolean", default: false },
      full: { type: "boolean", default: false },
      short: { type: "boolean", default: false },
      "no-animation": { type: "boolean", default: false },
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
  const interactive = process.stdout.isTTY === true && !values.json;
  const color = (process.stdout.isTTY === true || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
  const spinner = new Spinner(process.stderr, process.stderr.isTTY === true && !values.json && !process.env.CI);
  const fmt = (n: number) => n.toLocaleString("en-US");
  spinner.set("Reading your agent logs…");
  const result = await runAudit(
    { sinceMs: parsePeriod(values.last, values.since, now), untilMs: parseUntil(values.until, now), sources, claudeRoots: claudeRoots(), codexHome: codexHome(), prices: loadPrices() },
    new URL(import.meta.url),
    values.jobs ? Math.max(1, Number(values.jobs)) : defaultJobs(),
    // With a spinner, replay progress shows there instead of as log lines.
    { ids: saverIndex(saverIds).map((x) => x.id), full: values["full-replay"], cacheFile: defaultReplayCachePath(), log: process.stderr.isTTY ? undefined : log },
    {
      files: (done, total) => spinner.set(`Reading logs… ${fmt(done)}/${fmt(total)} files`),
      replay: (saver, done, total) => spinner.set(`Replaying through ${saver}… ${fmt(done)}/${fmt(total)} (cached next time)`),
    },
  );
  const elapsedMs = performance.now() - t0;
  const showProjects = values["show-projects"];

  // The share card: by default in a terminal (it is what people share), elsewhere on request.
  let cardPath: string | undefined;
  const wanted = values["no-card"] ? undefined : values.card ?? (interactive ? "saver-audit.png" : undefined);
  if (wanted && result.calls > 0) {
    spinner.set("Drawing your share card…");
    const { writeCard } = await import("./report/card.ts");
    for (const path of [wanted, join(tmpdir(), "saver-audit.png")]) {
      try {
        await writeCard(result, path);
        cardPath = path;
        break;
      } catch {
        // folder not writable: fall back to the temp folder
      }
    }
  }
  spinner.stop();

  const opts = { showProjects, verbose: values.verbose, color, elapsedMs, cardPath };
  if (values.json) {
    if (cardPath) log(`share card written to ${cardPath} (numbers, model names and dates only)`);
    process.stdout.write(renderJson(result, { showProjects, version: VERSION }));
    return 0;
  }
  const animate = canAnimate(process.stdout, values["no-animation"]);
  if (values.short) {
    await reveal(process.stdout, renderShort(result, opts), animate);
    return 0;
  }
  if (!interactive || values.full || result.calls === 0) {
    await reveal(process.stdout, renderTerminal(result, opts), animate);
    if (cardPath) log(`share card written to ${cardPath} (numbers, model names and dates only)`);
    return 0;
  }
  await reveal(process.stdout, renderShort(result, opts), animate);
  if (!process.stdin.isTTY) {
    process.stdout.write("\nFull report: saver-audit --full\n");
    return 0;
  }
  const { copyImage, intentUrl, openExternal, shareText } = await import("./report/share.ts");
  await keyMenu(
    process.stdout,
    [
      {
        key: "f",
        label: "full report",
        run: async () => {
          process.stdout.write("\n");
          await reveal(process.stdout, renderTerminal(result, opts), animate);
        },
      },
      {
        key: "s",
        label: "share on X",
        run: () => {
          const copied = cardPath ? copyImage(resolve(cardPath)) : false;
          const opened = openExternal(intentUrl(shareText(result)));
          process.stdout.write(`\n${opened ? "Opened X with your numbers filled in." : "Could not open a browser. Post this link: " + intentUrl(shareText(result))}\n`);
          if (copied) process.stdout.write("Your card is on the clipboard: paste it into the post (⌘V / Ctrl+V), then Post.\n");
          else if (cardPath) {
            openExternal(resolve(cardPath), true);
            process.stdout.write(`Attach your card to the post: ${resolve(cardPath)}\n`);
          }
        },
      },
      ...(cardPath ? [{ key: "o", label: "open card", run: () => void openExternal(resolve(cardPath!)) }] : []),
    ],
    color,
  );
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
