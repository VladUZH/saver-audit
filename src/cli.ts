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
  --install-savers        download rtk and the caveman engine from their official
                         releases into ~/.saver-audit/tools (verified; asks first)
  --with-headroom        also install headroom + its model (about 1.6 GB, Python 3.10+)
  -y, --yes              don't ask before installing
  --update-prices        fetch a fresh public price list
  --verbose              more detail about skipped records
  -h, --help / -v, --version

Savers: rtk, caveman-engine, headroom (replayed on your installed copies),
caveman-skill (modeled), codegraph, context-mode (upper bounds).

Reads ~/.claude/projects and ~/.codex/sessions locally. Nothing leaves your machine.
Network only when you ask: --update-prices, --install-savers / [i], and [s] opens x.com.
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
      "install-savers": { type: "boolean", default: false },
      "with-headroom": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
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
  const interactive = process.stdout.isTTY === true && !values.json;
  const color = (process.stdout.isTTY === true || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
  const showSpinner = process.stderr.isTTY === true && !values.json && !process.env.CI;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const showProjects = values["show-projects"];
  const wanted = values["no-card"] ? undefined : values.card ?? (interactive ? "saver-audit.png" : undefined);

  // Optional, explicit install of the replayed savers (downloads; says so first).
  if (values["install-savers"]) {
    const ok = await installFlow({ all: values["with-headroom"], assumeYes: values.yes, color });
    if (!ok) return 1;
  }

  /** One full audit: logs → report data → share card. Re-run after an install. */
  const audit = async () => {
    const t0 = performance.now();
    const spinner = new Spinner(process.stderr, showSpinner);
    spinner.set("Reading your agent logs…");
    const result = await runAudit(
      { sinceMs: parsePeriod(values.last, values.since, now), untilMs: parseUntil(values.until, now), sources, claudeRoots: claudeRoots(), codexHome: codexHome(), prices: loadPrices() },
      new URL(import.meta.url),
      values.jobs ? Math.max(1, Number(values.jobs)) : defaultJobs(),
      // With a spinner, replay progress shows there instead of as log lines.
      { ids: saverIndex(saverIds).map((x) => x.id), full: values["full-replay"], cacheFile: defaultReplayCachePath(), log: showSpinner ? undefined : log },
      {
        files: (done, total) => spinner.set(`Reading logs… ${fmt(done)}/${fmt(total)} files`),
        replay: (saver, done, total) => spinner.set(`Replaying through ${saver}… ${fmt(done)}/${fmt(total)} (cached next time)`),
      },
    );
    const elapsedMs = performance.now() - t0;
    // The share card: by default in a terminal (it is what people share), elsewhere on request.
    let cardPath: string | undefined;
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
    return { result, opts: { showProjects, verbose: values.verbose, color, elapsedMs, cardPath } };
  };

  let { result, opts } = await audit();
  if (values.json) {
    if (opts.cardPath) log(`share card written to ${opts.cardPath} (numbers, model names and dates only)`);
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
    if (opts.cardPath) log(`share card written to ${opts.cardPath} (numbers, model names and dates only)`);
    return 0;
  }
  await reveal(process.stdout, renderShort(result, opts), animate);
  if (!process.stdin.isTTY) {
    process.stdout.write("\nFull report: saver-audit --full\n");
    return 0;
  }
  const { copyImage, intentUrl, openExternal, shareText } = await import("./report/share.ts");
  const missing = () => result.savers.some((x) => x.status === "not installed");
  await keyMenu(
    process.stdout,
    () => [
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
          const copied = opts.cardPath ? copyImage(resolve(opts.cardPath)) : false;
          const opened = openExternal(intentUrl(shareText(result)));
          process.stdout.write(`\n${opened ? "Opened X with your numbers filled in." : "Could not open a browser. Post this link: " + intentUrl(shareText(result))}\n`);
          if (copied) process.stdout.write("Your card is on the clipboard: paste it into the post (⌘V / Ctrl+V), then Post.\n");
          else if (opts.cardPath) {
            openExternal(resolve(opts.cardPath), true);
            process.stdout.write(`Attach your card to the post: ${resolve(opts.cardPath)}\n`);
          }
        },
      },
      ...(opts.cardPath ? [{ key: "o", label: "open card", run: () => void openExternal(resolve(opts.cardPath!)) }] : []),
      ...(missing()
        ? [
            {
              key: "i",
              label: "install savers",
              run: async (ask: (q: string) => Promise<boolean>) => {
                const ok = await installFlow({ all: false, assumeYes: false, color, ask });
                if (!ok) return;
                ({ result, opts } = await audit());
                process.stdout.write("\n");
                await reveal(process.stdout, renderShort(result, opts), animate);
              },
            },
          ]
        : []),
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

interface InstallFlowOptions {
  /** Include headroom (large) without asking about it separately. */
  all: boolean;
  assumeYes: boolean;
  color: boolean;
  /** Yes/no question; defaults to a line-based prompt on stdin. */
  ask?: (q: string) => Promise<boolean>;
}

/** Explains, asks, then installs the missing savers. Returns false if nothing was installed. */
async function installFlow(o: InstallFlowOptions): Promise<boolean> {
  const { install, installPlan } = await import("./savers/install.ts");
  const { detectReplayTools } = await import("./savers/replay.ts");
  const { toolsDir } = await import("./savers/toolsdir.ts");
  const have = detectReplayTools();
  const out = process.stdout;
  const bold = (x: string) => (o.color ? `\x1b[1m${x}\x1b[0m` : x);
  const ask = o.ask ?? askLine;
  const plan = installPlan().filter((c) => !have.has(c.id));
  if (!plan.length) {
    out.write("\nAll replayed savers are already installed.\n");
    return false;
  }
  out.write(`\n${bold("Install savers so saver-audit can replay your sessions through them")}\n`);
  out.write(`Downloads from each saver's official release into ${toolsDir()}, verified before use.\n`);
  out.write("Your Claude Code and Codex settings are not touched. Delete that folder to uninstall.\n");
  let installed = 0;
  for (const c of plan) {
    if (!c.available) {
      out.write(`  ${c.what}: skipped (${c.why})\n`);
      continue;
    }
    const yes = o.assumeYes ? c.id !== "headroom" || o.all : await ask(`  Install ${c.what} (${c.size})? [y/N] `);
    if (!yes) continue;
    const spinner = new Spinner(process.stderr, process.stderr.isTTY === true);
    try {
      await install(c.id, (msg) => spinner.set(msg));
      spinner.stop();
      out.write(`  ${c.what}: installed\n`);
      installed++;
    } catch (err) {
      spinner.stop();
      out.write(`  ${c.what}: not installed (${err instanceof Error ? err.message : String(err)})\n`);
    }
  }
  return installed > 0;
}

async function askLine(q: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}
