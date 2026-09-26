// saver-audit: where your Claude Code and Codex tokens go. Offline by default.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { parseArgs } from "node:util";
import { runAudit, runWorker, defaultJobs, defaultReplayCachePath, WORKER_FLAG } from "./pool.ts";
import { allSavers, saverIndex } from "./savers/registry.ts";
import { claudeRoots } from "./sources/claude-code.ts";
import { codexHome } from "./sources/codex.ts";
import { loadPrices, userPricesPath } from "./prices/load.ts";
import { menuKeys, renderShort, renderTerminal } from "./report/terminal.ts";
import { canAnimate, keyMenu, reveal, Spinner } from "./report/present.ts";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { renderJson } from "./report/json.ts";
import type { Source } from "./sources/types.ts";
import type { AuditResult } from "./audit.ts";
import { periodOf } from "./period.ts";
import { normalizeCardArg, parseJobs } from "./args.ts";
import { exactSeconds } from "./savers/replay.ts";
import { HEADROOM_VERSION, installOffer, installPlan, toolPaths, toolsDir, type InstallChoice, type InstallOffer } from "./savers/toolsdir.ts";
import { VERSION } from "./version.ts";


const HELP = `saver-audit — where your Claude Code and Codex tokens really go

Usage: saver-audit [options]

  --last <N>d|w|h        period to audit, counted back from --until (default 30d)
  --since <YYYY-MM-DD>   start date instead of --last
  --until <YYYY-MM-DD>   last day included (default: now)
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
  --exact                exact saver numbers: replay every output (can take minutes on a
                         busy month; cached, so later runs are exact too). Default: a
                         quick run whose sampled numbers are marked "indicative"
  --install-savers       download rtk, the caveman engine, token-saver and lean-ctx
                         from their official GitHub releases into ~/.saver-audit/tools
                         (pinned and verified; asks before each unless -y)
  --with-headroom        also install headroom + its model (about 1.6 GB, Python 3.10+)
                         from PyPI and Hugging Face (not verified by saver-audit)
  -y, --yes              don't ask before installing
  --check-saver <file>   validate a saver manifest and try its program (for saver authors)
  --update-prices        fetch a fresh public price list
  --verbose              more detail about skipped records
  -h, --help / -v, --version

Savers: rtk, caveman-engine, token-saver, lean-ctx, headroom (replayed on your
installed copies), caveman-skill (modeled), codegraph, context-mode (upper bounds).

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
      "check-saver": { type: "string" },
      "show-projects": { type: "boolean", default: false },
      "update-prices": { type: "boolean", default: false },
      savers: { type: "string" },
      "no-savers": { type: "boolean", default: false },
      "full-replay": { type: "boolean", default: false },
      exact: { type: "boolean", default: false },
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
  if (values["check-saver"]) return checkSaver(values["check-saver"]);
  if (values["update-prices"]) {
    const { updatePrices } = await import("./prices/update.ts");
    await updatePrices(userPricesPath(), log);
  }
  // Community manifests that could not be loaded: say so once, details with --verbose.
  const problems = values["no-savers"] ? [] : allSavers().problems;
  if (problems.length) log(values.verbose ? `saver manifests skipped:\n${problems.map((p) => `  - ${p}`).join("\n")}` : `saver-audit: ${problems.length} saver manifest(s) in ~/.saver-audit/savers skipped (--verbose for details)`);
  const saverIds = values["no-savers"] ? [] : values.savers ? values.savers.split(",").map((x) => x.trim()).filter(Boolean) : allSavers().savers.map((x) => x.id);

  const src = values.source;
  if (src !== "all" && src !== "claude-code" && src !== "codex") throw new Error(`--source: expected claude-code, codex or all, got ${src}`);
  const sources: Source[] = src === "all" ? ["claude-code", "codex"] : [src];
  const now = Date.now();
  // Checked before anything starts, so a typo never leaves a spinner or an install behind.
  const { sinceMs, untilMs } = periodOf(values, now);
  const jobs = parseJobs(values.jobs) ?? defaultJobs();
  const interactive = process.stdout.isTTY === true && !values.json;
  const color = (process.stdout.isTTY === true || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
  const showSpinner = process.stderr.isTTY === true && !values.json && !process.env.CI;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const showProjects = values["show-projects"];
  const wanted = values["no-card"] ? undefined : values.card ?? (interactive ? "saver-audit.png" : undefined);

  // Optional, explicit install of the replayed savers (downloads; says so first). The
  // report follows either way, on what is installed; a failed install exits 1 after it.
  let code = 0;
  if (values["install-savers"]) {
    const { failed } = await installFlow({ all: values["with-headroom"], assumeYes: values.yes, color, out: values.json ? process.stderr : process.stdout });
    if (failed) code = 1;
  }

  /** One full audit: logs → report data → share card. Re-run after an install. */
  const audit = async (exact: boolean | string[] = values.exact || values["full-replay"]) => {
    const t0 = performance.now();
    const progress = new Map<string, string>();
    const spinner = new Spinner(process.stderr, showSpinner, color);
    // Warnings (cache not saved, a saver's model missing) wait until the spinner is gone.
    const warnings: string[] = [];
    // The spinner line is cleared before anything else is printed, an error included.
    try {
      spinner.set("Reading your agent logs…");
      const result = await runAudit(
        { sinceMs, untilMs, sources, claudeRoots: claudeRoots(), codexHome: codexHome(), prices: loadPrices() },
        new URL(import.meta.url),
        jobs,
        // With a spinner, replay progress shows there instead of as log lines.
        { ids: saverIndex(saverIds).map((x) => x.id), full: exact, cacheFile: defaultReplayCachePath(), log: showSpinner ? undefined : log, warn: showSpinner ? (s) => void warnings.push(s) : log },
        {
          files: (done, total) => spinner.set(`Reading logs… ${fmt(done)}/${fmt(total)} files`),
          replay: (saver, done, total) => {
            progress.set(saver, `${saver} ${fmt(done)}/${fmt(total)}`);
            spinner.set(`${exact ? "Exact replay" : "Quick check"}: ${[...progress.values()].join(" · ")}`);
          },
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
      return { result, opts: { showProjects, verbose: values.verbose, color, elapsedMs, cardPath } };
    } finally {
      spinner.stop();
      for (const w of warnings) log(w);
    }
  };

  let { result, opts } = await audit();
  if (values.json) {
    if (opts.cardPath) log(`share card written to ${opts.cardPath} (numbers, model names and dates only)`);
    process.stdout.write(renderJson(result, { showProjects, version: VERSION }));
    return code;
  }
  const animate = canAnimate(process.stdout, values["no-animation"]);
  // What [i] could install, looked at once per result (it may run Python).
  let withPython: InstallChoice[] | undefined;
  const plan = (python: boolean) => (python ? (withPython ??= installPlan()) : installPlan(process.platform, process.arch, null));
  const offers = new WeakMap<AuditResult, InstallOffer>();
  const install = () => offers.get(result) ?? offers.set(result, installOffer(result.savers, plan)).get(result)!;
  // The short view names a key only when the menu that follows offers it (menuKeys).
  const shortView = (menu: boolean) => renderShort(result, { ...opts, menu, install: install() });
  if (values.short) {
    await reveal(process.stdout, shortView(false), animate);
    return code;
  }
  if (!interactive || values.full || result.calls === 0) {
    await reveal(process.stdout, renderTerminal(result, opts), animate);
    if (opts.cardPath) log(`share card written to ${opts.cardPath} (numbers, model names and dates only)`);
    return code;
  }
  const menu = process.stdin.isTTY === true;
  await reveal(process.stdout, shortView(menu), animate);
  if (!menu) {
    process.stdout.write("\nFull report: npx saver-audit --full\n");
    return code;
  }
  const { copyImage, intentUrl, openExternal, shareText } = await import("./report/share.ts");
  const keys = () => menuKeys(result, { menu, install: install() });
  const exactWork = () => exactSeconds(new Map(result.savers.filter((x) => x.replay).map((x) => [x.id, x.replay!])));
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
        run: async () => {
          const copied = opts.cardPath ? copyImage(resolve(opts.cardPath)) : false;
          const url = intentUrl(shareText(result));
          const opened = await openExternal(url);
          process.stdout.write(`\n${opened ? "Opened X with your numbers filled in." : `Could not open a browser. Post this link: ${url}`}\n`);
          if (copied) process.stdout.write("Your card is on the clipboard: paste it into the post (⌘V / Ctrl+V), then Post.\n");
          else if (opts.cardPath) {
            void openExternal(resolve(opts.cardPath), true);
            process.stdout.write(`Attach your card to the post: ${resolve(opts.cardPath)}\n`);
          }
        },
      },
      ...(opts.cardPath
        ? [
            {
              key: "o",
              label: "open card",
              run: async () => {
                if (!(await openExternal(resolve(opts.cardPath!)))) process.stdout.write(`\nCould not open the card: ${resolve(opts.cardPath!)}\n`);
              },
            },
          ]
        : []),
      ...(keys().exact
        ? [
            {
              key: "e",
              label: `exact numbers (${duration(exactWork().total)})`,
              run: async (ask: (q: string) => Promise<boolean>) => {
                const work = exactWork();
                const hr = work.bySaver.find(([s]) => s === "headroom");
                const rest = work.bySaver.filter(([s]) => s !== "headroom");
                process.stdout.write(`\nExact numbers replay every output not measured yet: ${work.bySaver.map(([s, t]) => `${s} ${duration(t)}`).join(", ")}.\n`);
                let only: string[] | true = true;
                if (hr && hr[1] > 600) {
                  const withHr = await ask(`  headroom alone takes ${duration(hr[1])}. Include it? [y/N] `);
                  if (!withHr) only = rest.map(([s]) => s);
                }
                if (only !== true && !only.length) return;
                const secs = only === true ? work.total : rest.reduce((n, [, t]) => n + t, 0);
                if (!(await ask(`  Start (${duration(secs)}; you can stop with Ctrl+C and resume later)? [y/N] `))) return;
                ({ result, opts } = await audit(only));
                process.stdout.write("\n");
                await reveal(process.stdout, shortView(true), animate);
              },
            },
          ]
        : []),
      ...(keys().install
        ? [
            {
              key: "i",
              label: "install savers",
              run: async (ask: (q: string) => Promise<boolean>) => {
                const { installed } = await installFlow({ all: false, assumeYes: false, color, ask, out: process.stdout });
                if (!installed) return;
                ({ result, opts } = await audit());
                process.stdout.write("\n");
                await reveal(process.stdout, shortView(true), animate);
              },
            },
          ]
        : []),
    ],
    color,
  );
  return code;
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
  /** Where the installer talks: stderr under --json, so stdout stays JSON. */
  out: NodeJS.WriteStream;
}

/** Explains, asks, then installs the missing savers. Counts what was installed and what failed. */
async function installFlow(o: InstallFlowOptions): Promise<{ installed: number; failed: number }> {
  const { headroomIncomplete, install } = await import("./savers/install.ts");
  const { detectReplayTools, isOutdated } = await import("./savers/replay.ts");
  const have = detectReplayTools();
  const out = o.out;
  const bold = (x: string) => (o.color ? `\x1b[1m${x}\x1b[0m` : x);
  const ask = o.ask ?? ((q: string) => askLine(q, out));
  // Without a terminal nobody can answer: say so instead of declining in silence.
  const canAsk = o.assumeYes || !!o.ask || process.stdin.isTTY === true;
  // Our headroom imports but its model or tokenizer is missing (a download that failed): finish it.
  if (o.all && have.get("headroom")?.command === toolPaths.headroomPython() && headroomIncomplete()) {
    have.delete("headroom");
    out.write("\nheadroom is installed but its model or tokenizer is missing; finishing the install.\n");
  }
  // One found but older than its adapter (an old rtk on PATH) is offered too: once the
  // current one is in the tools folder, detection takes it. Not headroom: a user's own
  // headroom always comes first.
  const older = (id: string) => {
    const t = have.get(id);
    return t && id !== "headroom" && isOutdated(t.version, saverIndex([id])[0]!.version) ? t.version : undefined;
  };
  // headroom is 1.6 GB and minutes of waiting: only on explicit request (--with-headroom).
  const plan = installPlan().filter((c) => (!have.has(c.id) || older(c.id)) && (c.id !== "headroom" || o.all));
  if (!plan.length) {
    out.write(have.has("headroom") || o.all ? "\nAll replayed savers are already installed.\n" : "\nThe quick savers are installed. headroom (1.6 GB, minutes): npx saver-audit --install-savers --with-headroom\n");
    return { installed: 0, failed: 0 };
  }
  out.write("\n");
  // Nothing here can be installed on this machine: only the reasons, no download banner.
  if (plan.some((c) => c.available)) {
    out.write(`${bold("Install savers so saver-audit can replay your sessions through them")}\n`);
    out.write(`Everything goes into ${toolsDir()}; your Claude Code and Codex settings are not touched. Delete that folder to uninstall.\n`);
    // Only the GitHub release downloads are pinned and verified; headroom's are not (below).
    if (plan.some((c) => c.available && c.id !== "headroom")) out.write("Downloads from each saver's official GitHub release are pinned and verified before use.\n");
  }
  let installed = 0;
  let failed = 0;
  const unasked: string[] = [];
  for (const c of plan) {
    if (!c.available) {
      out.write(`  ${c.what}: skipped (${c.why})\n`);
      continue;
    }
    if (older(c.id)) out.write(`  ${c.what}: the ${older(c.id)} found is older than the version saver-audit was written for.\n`);
    if (!canAsk) {
      unasked.push(c.what);
      continue;
    }
    if (c.id === "headroom") out.write(`  headroom comes from PyPI (headroom-ai ${HEADROOM_VERSION}; pip chooses its dependencies) and its model from Hugging Face. saver-audit does not pin or verify these downloads.\n`);
    const yes = o.assumeYes || (await ask(`  Install ${c.what} (${c.size})? [y/N] `));
    if (!yes) continue;
    const spinner = new Spinner(process.stderr, process.stderr.isTTY === true, o.color);
    try {
      await install(c.id, (msg) => spinner.set(msg));
      spinner.stop();
      out.write(`  ${c.what}: installed\n`);
      installed++;
    } catch (err) {
      spinner.stop();
      out.write(`  ${c.what}: not installed (${err instanceof Error ? err.message : String(err)})\n`);
      failed++;
    }
  }
  if (unasked.length) out.write(`  Not installed, since input is not a terminal and nobody could be asked: ${unasked.join(", ")}. Run again with --yes to install ${unasked.length === 1 ? "it" : "them"}.\n`);
  return { installed, failed };
}

async function askLine(q: string, out: NodeJS.WriteStream): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: out });
  const a = await rl.question(q);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

/** For saver authors: validate a manifest, find its program, run it once on a sample. */
async function checkSaver(file: string): Promise<number> {
  const { readFileSync, rmSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { routeArgs, usesCommand, validateManifest } = await import("./savers/manifest.ts");
  const { manifestAdapter, SAVERS } = await import("./savers/registry.ts");
  const { detectReplayTools, makeStateDir, ratioResult, saverRunEnv } = await import("./savers/replay.ts");
  const out = process.stdout;
  let m: any;
  try {
    m = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    out.write(`${file}: not valid JSON (${err instanceof Error ? err.message : String(err)})\n`);
    return 1;
  }
  const problems = validateManifest(m);
  // The audit skips a user manifest whose id a built-in saver has; one written as code
  // (headroom, the caveman skill) cannot be a built-in manifest either.
  const taken = problems.length ? undefined : SAVERS.find((x) => x.id === m.id);
  if (taken && !taken.manifest) problems.push(`id "${m.id}" is already taken by a built-in saver`);
  if (problems.length) {
    out.write(`${file}: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    return 1;
  }
  out.write(`${file}: valid ${m.method} manifest for "${m.id}" (${m.routes.length} route${m.routes.length === 1 ? "" : "s"})\n`);
  if (taken) out.write(`  id "${m.id}" is already taken by a built-in saver, so a copy in ~/.saver-audit/savers/ would be skipped: give your saver its own id, or change src/savers/builtin/${m.id}.json in a pull request.\n`);
  if (m.method !== "replayed") return 0;
  const tool = detectReplayTools([manifestAdapter(m)]).get(m.id);
  if (!tool) {
    out.write(`  program "${m.binary}" not found on PATH or in ~/.saver-audit/tools/bin${m.binaryEnv ? ` (or set ${m.binaryEnv})` : ""}\n`);
    return 1;
  }
  out.write(`  program: ${tool.command}${tool.version ? ` (${tool.version})` : ""}\n`);
  // Run as a replay runs it: the first route with a sample command for "{command}", the
  // manifest's environment, and a temporary state folder (removed after).
  const sample = Array.from({ length: 40 }, (_, i) => `line ${i}: PASSED tests/test_example.py::test_${i}`).join("\n");
  const command = "pytest -q";
  const args = routeArgs(m.routes[0], command);
  if (usesCommand(m.routes[0])) out.write(`  sample command for "{command}": ${command}\n`);
  let state: string;
  try {
    state = makeStateDir();
  } catch (err) {
    out.write(`  cannot create a temporary folder (${(err as NodeJS.ErrnoException).code ?? "error"}); no sample run\n`);
    return 1;
  }
  const t0 = performance.now();
  let r;
  try {
    r = spawnSync(tool.command, args, { input: sample, encoding: "utf8", timeout: 30_000, cwd: join(state, "empty"), env: saverRunEnv(m, state, tool.env) });
  } finally {
    rmSync(state, { recursive: true, force: true, maxRetries: 3 });
  }
  const ms = Math.round(performance.now() - t0);
  if (r.status !== 0) {
    out.write(`  sample run failed: exit ${r.status ?? "?"}${r.stderr ? `: ${String(r.stderr).trim().split("\n").pop()}` : ""}\n`);
    return 1;
  }
  // A replay whose output lacks the counts fails too.
  if (m.jsonRatio && !ratioResult(String(r.stdout), m.jsonRatio, 1000)) {
    out.write(`  sample run failed: its output is not JSON with numbers in "${m.jsonRatio.before}" and "${m.jsonRatio.after}" (jsonRatio)\n`);
    return 1;
  }
  out.write(`  sample run ok: ${sample.length} chars in, ${String(r.stdout).length} chars out, ${ms} ms\n`);
  if (!taken) out.write(`  To use it: copy the file into ~/.saver-audit/savers/, then run saver-audit.\n`);
  return 0;
}

/** "about 40 s", "about 6 min", "about 2 h". */
function duration(secs: number): string {
  if (secs < 90) return `about ${Math.max(5, Math.round(secs / 5) * 5)} s`;
  if (secs < 90 * 60) return `about ${Math.round(secs / 60)} min`;
  return `about ${(secs / 3600).toFixed(secs < 36000 ? 1 : 0)} h`;
}
