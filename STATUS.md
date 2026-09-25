# STATUS — saver-audit

Append-only log. After every task: what was done, how it was verified (command + result),
what is blocked and why, and decisions made where the docs were silent.

## Current milestone

M4 — launch prep: **done on Claude's side.** saver-audit 0.1.0 is on npm; README, card, GIF
and launch kit carry the final numbers. Left for the founder: write and post the Show HN,
Reddit posts and X thread from `docs/launch/` (plan: Show HN Sunday 2026-10-04 12:00–14:00 UTC).

## Log

- 2026-09-25 — Project folder prepared: CLAUDE.md, docs/01–05, tech-notes, evidence,
  one-pager. No code yet.

- 2026-09-25 — Research landed (docs/05-distribution.md, docs/tech-notes.md) and the docs
  were updated: the premise is already public (June r/LocalLLaMA 500-session replay: 3.7%),
  so the product leads with "where your tokens go"; dedupe and baseline rules; Codex
  specifics; saver classes; licences; prices; Show HN title limits. npm name `saver-audit`
  free on 2026-09-25.

- 2026-09-25 — **M0 done.** tech-notes.md §8 added (dated, verified sources and savers).
  - M0.1 sources: `node scripts/probe-schema.mjs claude` → `files=1349 lines=303018
    unparseable=15`, versions 2.1.156–2.1.282; `node scripts/probe-schema.mjs codex` →
    `files=1295 lines=553183 unparseable=28`, versions 0.70.0-alpha.4–0.155.0-alpha.16.3.
    Numeric check (scratch script, not committed): Claude 49,509 unique calls,
    38,524 multi-line, input/cache differ across copies in 6, output in 3,809, 41 without
    requestId, 569 `<persisted-output>` previews; Codex 108,091 token_count events,
    cached ≤ input on all, total = in+out on 107,329, cache_write always 0, 4,106 repeats.
    Output checked by hand: only key names, types, counts and model/type enums printed.
  - M0.2 savers: verified from README + source at pinned commits (tech-notes §8.5).
    Corrections to earlier notes: caveman no longer publishes a skill input overhead or
    output reduction; fast-jev can drop whole tool pairs (upper bound = drop all
    non-pinned pairs, not 300-char cut); context-mode's 5,000-byte rule needs an agent
    `intent` (always indexes only above 102,400 bytes); headroom's model is
    kompress-v2-base (~261 MB int8) and its beacon is on by default; rtk `pipe` git-status
    and git-log filters expect rtk's own injected formats.
  - M0.3 tokenizer: `npm view gpt-tokenizer` → 4.0.0, MIT, no deps; tarball 9.1 MB;
    o200k_base ~47 MB/s on synthetic text (Node 24).
  - Full scan of all local history takes ~15–21 s per source → M1 needs an mtime prefilter.
  - Commits: `e16863f` docs, `90ca207` probe script, then tech-notes/STATUS.

- 2026-09-25 — **M1 done.** Parsers (Claude Code, Codex, streaming), dedupe, calibration,
  cache-aware cost, context attribution, terminal report sections 1/2/4/5, `--json`,
  `--update-prices`, worker pool. Verified:
  - `npm test` → `ℹ tests 30 ℹ pass 30 ℹ fail 0` (synthetic fixtures only; includes
    hand-computed totals, golden JSON, offline and privacy tests).
  - `npx tsc -p tsconfig.json` → no errors. `npm run build` → `dist/cli.js 3.3mb`;
    `npm pack --dry-run` → package size 1.1 MB, 4 files, zero runtime dependencies.
  - `node scripts/crosscheck-usage.mjs 30` (independent sum of deduplicated recorded
    usage, no saver-audit parser) → input/cache write/cache read/output/total all
    `diff 0.000%`, `PASS: within 1%`. It shares the dedupe rules, so it checks the
    implementation, not the rules; ccusage is not installed here, so no ccusage check.
  - `/usr/bin/time -p node dist/cli.js --last 30d` three runs → real 7.20 / 7.23 / 6.75 s
    (1,207 files, 1.8 GB Claude + 99 MB Codex). Earlier runs under machine load: 9.8–10.6 s.
  - Real-log report: $4,430 API-equivalent over 30 days, 38.9k calls. (Founder's
    numbers; not launch copy yet.)
  - Findings recorded in tech-notes §8.6 (calibration k ≈ 1.5 for Claude 4.7+,
    thinking re-sent, Codex token_count ordering, attachment sizing, perf).
- 2026-09-25 — Test bug caught and fixed before commit: `test/cli.test.ts` imported
  `src/cli.ts`, which ran a real audit of `~/.claude` during `npm test` (local only,
  output to the test log). `parsePeriod` moved to `src/period.ts`; tests now only read
  fixtures.

- 2026-09-25 — **GATE done by Claude on the founder's instruction** ("Create the repo
  yourself"): `gh repo create VladUZH/saver-audit --public --source . --push` →
  https://github.com/VladUZH/saver-audit, created 2026-09-25T13:56:59Z. awesome-claude-code
  eligibility (14 days): 2026-10-09.
- 2026-09-25 — Savers installed on the founder's instruction, isolated in
  `~/.saver-audit-tools` via `bash scripts/dev-install-savers.sh`: rtk 0.50.0 (release
  binary, SHA-256 checked), caveman-engine bin-v1.1.7 (sigstore signature over checksums
  verified with caveman's public key, then SHA-256), headroom-ai[ml] 0.38.0 (own venv,
  HF_HOME inside the folder, beacon off), ccusage 20.0.24 (own npm prefix). No `rtk init`
  / `caveman setup` run: no hooks, `~/.claude/settings.json` unchanged (mtime before
  install). Remove all with `rm -rf ~/.saver-audit-tools`.
- 2026-09-25 — **Bug found by the ccusage cross-check and fixed: Codex fork history was
  double counted.** Forked threads write `task_started` first, then re-record the
  parent's usage as a dense burst; my rule ended the replay at `task_started`, so the
  burst was billed again (two forks here: +85.6M input tokens each). Now the ccusage
  rule: in forked/child rollouts, skip the leading run of usage events ≤1 s apart.
  Also fixed: a `thread_settings_applied` without `service_tier` no longer resets the
  priority tier. Corrected 30-day total: **$4,259** (was reported as $4,430).
  Verified, window 2026-08-26 → now:
  - `ccusage claude daily --since 20260826 --offline --json` vs
    `saver-audit --source claude-code --json`: input 137,094 / cache write 185,663,095 /
    cache read 6,544,820,820 / output 20,854,124 → **0.000%** on every field.
  - `ccusage codex daily …` vs `saver-audit --source codex`: input incl. cached
    88,017,381 / cached 84,368,896 / output 250,404 → **0.000%**.
  - Codex dollars differ: ccusage $140.48, saver-audit $125.57. Decomposed: base list
    price $70.11, no call above the 272k tier; 653 of 783 calls follow a recorded
    `priority` setting (2×) → $125.41. ccusage also prices the 130 calls with no recorded
    tier as priority. Kept: no recorded tier = standard (see Decisions).
  - `npm test` → 31/31 pass; `node scripts/crosscheck-usage.mjs 30` → PASS 0.000%;
    `node dist/cli.js --last 30d` → 7.02 s / 6.89 s.

- 2026-09-25 — **M2 done.** Saver adapters (`src/savers/`): rtk, caveman-engine and
  headroom replayed on the installed binaries; caveman skill modeled; codegraph and
  context-mode upper bounds. Compounding cost model (removed tokens priced as cache write
  when first sent, cache read on each later call until compaction, same per-call rates as
  the context split). Report section 3 with method, coverage, tokens, $, share of bill and
  confidence; notes for sampling, assumptions, Codex, not-installed savers.
  New flags: `--savers`, `--no-savers`, `--full-replay`, `--until`. Verified:
  - `npm test` → `ℹ tests 40 ℹ pass 40 ℹ fail 0` (adds rtk filter mapping, persisted
    preview rule, coverage rules, hand-computed compounding and skill math, replay through
    fake saver binaries incl. cache and reproducibility, not-installed handling; privacy
    test now runs with savers on).
  - Real logs, `node dist/cli.js --since 2026-08-26 --until 2026-09-25T13:00:00`, three
    runs: every saver line labelled (replayed / modeled / upper bound); runs 2 and 3
    identical for all saver numbers and the whole report except per-run replay counters.
    Warm-cache run: 7.3–8.6 s. First run with an empty cache: 78 s.
  - Results on that window (sampled replay, NOT launch numbers): rtk $47 (1.1% of bill,
    high), caveman engine $9.7 (0.2%, sample 5%), headroom $151 (3.6%, sample 1%, lower
    estimate), caveman skill $95 (2.3%, assumed), codegraph ≤ $579 (13.8%, ceiling),
    context-mode ≤ $704 (16.7%, ceiling).
- 2026-09-25 — Bugs found and fixed during M2: (1) each run replayed a different sample
  (cached outputs were dropped before sampling) → sample now drawn from all applicable
  outputs; (2) calibration used calls outside the period → k drifted as this session wrote
  new logs; (3) replay failures were retried every run → cached as pass-through.
- 2026-09-25 — headroom setup needed three extra steps in the tools folder: `pip install
  "onnxruntime>=1.24"` into its venv, the ModernBERT tokenizer files via
  `huggingface_hub.snapshot_download`, and `HEADROOM_WORKSPACE_DIR`. My first headroom
  test ran without `HEADROOM_WORKSPACE_DIR` and created `~/.headroom/ccr_store.db`
  (45 KB, did not exist before); my `rm -rf ~/.headroom` was blocked by the permission
  system, so it is still there (see Human steps).

- 2026-09-25 — **M3 done.** `--card [path]` writes a 1200×675 PNG (SVG → PNG offline via
  resvg WASM + bundled JetBrains Mono); README with the founder's measured results;
  card privacy test. Verified:
  - `npm test` → `ℹ tests 43 ℹ pass 43 ℹ fail 0` (card: SVG built from fixtures holds no
    fixture text, paths, commands or project names; PNG signature and 1200×675 size).
  - `npm pack` → package size 2.3 MB, 8 files. In an empty directory:
    `npx --yes --package=<tgz> saver-audit --since 2026-08-26 --until 2026-09-25T13:00:00
    --card` → report printed, `saver-audit.png` written, real 9.21 s.
  - Card from the real run checked by eye: numbers, dates and fixed labels only.
  - Full replays: rtk (5,513 outputs) and caveman-engine (60,341 outputs, 195 s) done
    and cached; caveman full = $14.06 vs $9.69 from the 5% sample (tech-notes §8.8).
- 2026-09-25 — Bug found and fixed (again): `test/card.test.ts` imported `src/cli.ts`
  (which runs the CLI on import) and `test/savers.test.ts` (tests registered twice).
  Helpers moved to `src/args.ts` / `test/helpers.ts`; new test fails if anything imports
  `src/cli.ts`.

- 2026-09-25 — headroom full replay started on the founder's OK (`--savers headroom
  --full-replay`, same window; `caffeinate -i`; log in
  `~/.saver-audit-tools/headroom-full-replay.log`). Added a cache checkpoint every 250
  outputs first, so an interruption resumes. Speed: 250 outputs in about 65 s → 29,731
  outputs in about 2 h. Costs no money: local model, offline, no API calls.
- 2026-09-25 — **M4 prep (1–4):**
  - npm: version 0.1.0; repository/homepage/bugs/author; MIT `LICENSE` added (was
    missing); version read from package.json; `prepublishOnly` = typecheck + test + build;
    README image now an absolute URL (renders on npmjs.com). `npm publish --dry-run` →
    43/43 tests, 10 files, 2.4 MB, no logs or fixtures. Bundle run under Node 20.20.2 on
    fixtures (report, workers, card) → works, so `engines: >=20` holds. `npm whoami` →
    E401 (not logged in): publishing is the founder's GATE.
  - `.github/ISSUE_TEMPLATE/share-your-card.yml` (validated YAML) and repo label
    `share-card` created.
  - `docs/launch/show-hn-fact-sheet.md`, `docs/launch/reddit-briefs.md`,
    `docs/launch/x-thread.md`; `docs/04-launch.md` links them. Codex-only and
    Claude-only numbers computed against a copy of the replay cache (so the running
    headroom replay's cache is not touched).

- 2026-09-25 — **headroom full replay done** (17:15 → about 19:05, 6,587 s; 118
  checkpoints; exit 0, no failures). Window 2026-08-26 → 2026-09-25T13:00: headroom
  **$152 (3.6%)**, versus $151 from the earlier 1% sample. Split: Claude Code $138.96
  (3.4% of $4,083.51), Codex $13.09 (10.4% of $125.39). Then replayed the ~200 outputs
  this session created after the cutoff so the card reads "high" (in-window numbers
  unchanged: rtk $47.07, caveman engine $14.06, headroom $152).
- 2026-09-25 — Final numbers filled into README, `assets/readme-card.png` (regenerated),
  `docs/launch/*` and `docs/04-launch.md`; no `⟦HEADROOM⟧` placeholders left. The full
  replay overturned a draft claim: on Codex the largest measured cut is headroom (10.4%),
  not rtk; rtk's Codex share corrected from 4.2% to 4.1% ($5.20 of $125.39).

- 2026-09-25 — Terminal GIF (M4): `scripts/make-demo-gif.mjs` runs the real CLI, writes
  an asciinema v2 recording and renders it with agg 1.9.0 (installed to
  `~/.saver-audit-tools/bin`, SHA-256 matched GitHub's asset digest; GPL-3.0, dev-only,
  not shipped). `assets/demo.gif`: 21.8 s, 124×44 terminal, 2.2 MB; recording contains no
  home paths or project names. The CLI now honours `FORCE_COLOR`.
- 2026-09-25 — Bug found via the GIF's last frame and fixed: outputs written after
  `--until` were still replayed and counted in coverage (so this live session kept
  showing "sample 99%"). They can reach no in-period call, so the saver tracker now skips
  them. Savings unchanged; headroom coverage 57% → 56%. Test added (44/44 pass).

- 2026-09-25 — **npm GATE done (founder authorised, founder authenticated).** `npm login`
  ran in the session; `npm publish` hit `EOTP` from the session (non-interactive, so npm
  cannot start its passkey/Touch ID prompt) and was completed by the founder in their own
  terminal with `npm publish --ignore-scripts` (checks had just passed: 44/44, fresh build).
  Verified:
  - `npm view saver-audit` → 0.1.0, created 2026-09-25T19:33:31Z, maintainer vlpetrov.
  - Published tarball unpacked and compared with the local build: all 10 files identical
    (`cmp`). Its shasum differs from the one printed in the failed attempt only through
    packing metadata.
  - `npx --yes saver-audit@0.1.0` in an empty folder: `--version` → 0.1.0. New-user run
    (no savers installed, empty cache): report printed, rtk/caveman engine/headroom listed
    "not installed", real 14.39 s. With the founder's savers + `--card`: identical saver
    numbers to the README, `saver-audit.png` written, real 16.08 s. Both include npx
    resolving and unpacking the package on a busy machine; local report runs take 7–9 s.
    Not claiming "under 10 s via npx" until measured on a quiet machine.

- 2026-09-25 — **0.2.0 (founder's feedback after testing 0.1.0 in their terminal):**
  1. Report appears line by line in a terminal (like the demo GIF), about 1.5 s; instant
     when piped, `--json`, CI, `NO_ANIMATION` or `--no-animation`.
  2. Short one-screen view by default in a terminal, then a key menu: `[f]` full report,
     `[s]` share on X, `[o]` open card, `[q]` quit. `--full` / `--short` flags. Piped
     output stays the full report.
  3. Spinner on stderr while running: file progress, replay progress, card drawing.
  4. Share card written by default in a terminal (`saver-audit.png` in the current
     folder, temp-folder fallback); `--no-card` to skip; non-interactive only with `--card`.
  5. Share on X: X's intent URL can pre-fill text but cannot attach images, so `s` opens
     the pre-filled post (numbers only, 246/280 characters on the founder's data) and
     copies the card to the clipboard (macOS osascript, Windows PowerShell, Linux
     wl-copy/xclip) for a paste; if copying fails it reveals the file. No upload: that
     would break "nothing leaves your machine".
  Verified: `npm test` → 48/48 (new: share text numbers-only and ≤ 280 with link, intent
  URL encoding, short view one screen and private, no default card when non-interactive).
  Real interactive run driven in a pseudo-terminal with `expect` (spinner → short view →
  menu → `f` full report → `q` exits; card written by default), 13.95 s incl. reveals.
  Clipboard copy tested on macOS: clipboard holds `«class PNGf»`. Browser/X not opened in
  testing. Demo GIF re-recorded with the short view (860×608, 100 KB).

- 2026-09-25 — **0.3.0 (founder's feedback after testing 0.2.0):**
  1. One-step saver install: `[i]` in the menu when savers are missing, or
     `--install-savers [--with-headroom] [--yes]`. Downloads the pinned official releases
     into `~/.saver-audit/tools` (`SAVER_AUDIT_HOME` to move it), verified (rtk: release
     checksums; caveman engine: checksums signed with caveman's public key, embedded);
     headroom into its own venv with onnxruntime, model and tokenizer. Asks per item;
     never runs a saver's own setup. After `[i]`, the audit re-runs and the view redraws.
     Detection order: env overrides → PATH (the user's own installs) → the tools folder.
  2. Caveat rewritten in plain words (short view, full report).
  3. X post leads with savings: measured savers with −% and $, then the spend they were
     measured against; without measured savers, the modeled figure and a labelled best
     case. Priority-ordered variants so it always fits 280 characters with the link.
  Verified: `npm test` → 52/52 (new: installer asset map, checksum parsing, caveman
  signature check on the real release files incl. tampering, post variants, offline guard
  now also covers install.ts and forbids static imports of network modules). Real install
  into a throwaway `SAVER_AUDIT_HOME`: `--install-savers --yes` → rtk v0.50.0 and caveman
  engine bin-v1.1.7 installed and verified; a plain run then found and replayed both
  (21.5 s with an empty cache); `~/.claude/settings.json` unchanged, no `~/.caveman`.
  Headroom path, same throwaway home: `--install-savers --with-headroom --yes` → venv,
  headroom-ai 0.38.0 + onnxruntime, model and tokenizer, 1.6 GB, then a replay on
  2026-09-24..25 ran with the Kompress model loaded (headroom $16.75, sample 5.4%);
  213 s total. No `~/.headroom` created. Interactive `[i]` flow driven with `expect`
  (y rtk, y caveman engine, n headroom → installed, re-run, view redrawn with both
  replayed and `[i]` still offered for headroom). Throwaway installs deleted afterwards.

- 2026-09-25 — **0.4.0 step 1 (founder: headroom too slow; are the numbers right; is
  "assumed" useful):**
  - headroom removed from the default install (`[i]` offers rtk + caveman engine); still
    available with `--install-savers --with-headroom`; the short view says why.
  - Short view, card and X post show measured (replayed) savers only; modeled and
    ceilings go on one grey "not measurable offline" line (full report keeps them).
  - Accuracy: checked sampling against full-replay truth (tech-notes §8.9). Uniform and
    size-stratified samples were off by up to 40% (caveman) and 37% (headroom, weekly).
    Now: rtk full; caveman engine full above a 500-token floor (0% error above the floor
    on every window; the floor makes it ~5% low, stated in its note; first run ~75 s,
    then cached); headroom floor 200 + stratified sample of 300, labelled, with the
    measured error range in its note.
  Verified: `npm test` → 52/52; accuracy table re-run with the new defaults (caveman 0%
  on month and each week; headroom −3% month, −20%…+37% weeks).

- 2026-09-25 — **0.4.0 step 2: community savers.** A saver is one JSON manifest
  (`src/savers/manifest.ts`, CONTRIBUTING.md): identity, method (`replayed` or
  `upper-bound`; modeled savers stay code because they need a cited source), stage
  (`tool` = hook, gets full raw output; `request` = proxy), binary, routes (match on tool,
  category, shell family, command regex over the last segment, size; args per route),
  size floor, env with `{state}`. rtk, caveman engine, codegraph and context-mode are now
  built-in manifests (`src/savers/builtin/*.json`); headroom (sidecar) and the caveman
  skill (modeled) stay code. User manifests load from `~/.saver-audit/savers/` (cannot
  replace a built-in id; problems reported, `--verbose` for details). `--check-saver
  <file>` validates, finds the program and runs it on a sample. Fixture convention
  `test/fixtures/savers/<id>/` (runs when the saver is installed, else skipped); rtk
  fixture recorded with real rtk 0.50.0. "Add a saver" issue form + `saver` label.
  Research: lowfat (zdk/lowfat, Apache-2.0, 575★) is not replayable today: its built-in
  filters run only live (`lowfat git status`); `lowfat filter` needs a `.lf` plugin file.
  Verified: `npm test` → 57/57; real-log numbers unchanged after moving rtk/caveman to
  manifests (rtk $47.07, caveman $13.31, headroom $151; no re-replay: cache keys kept).

- 2026-09-25 — **0.4.0 step 3: outreach prep.** `docs/launch/saver-outreach.md`: the ask,
  what maintainers get, etiquette, 3 templates, and a researched target list (25
  projects checked). Replayable today besides rtk/caveman: token-saver (stdin, needs the
  command → added `{command}` placeholder to route args, cache key includes it) and
  lean-ctx (JSON output; needs a text flag or a small adapter). Small-change asks:
  headroom (`compress --stdin`), lowfat (`--builtin`), snip, token-optimizer. pxpipe
  (image tokens, lossy) needs its own adapter. Big upper-bound audiences:
  codebase-memory-mcp 44.9k, code-review-graph 31.8k. `npm test` → 58/58.
  Sending any message is the founder's GATE.

### Savers in scope for the launch (M0 acceptance)

| Saver | Class | Condition |
|---|---|---|
| rtk | replayed (partial) | `rtk pipe --filter`, Bash outputs only; git status/log excluded (format mismatch) |
| caveman engine | replayed | user's own `caveman-engine` binary; skip with note if absent |
| headroom | replayed | user's own `headroom-ai[ml]` with cached model, offline + beacon off; skip with note otherwise |
| caveman skill | modeled | JetBrains −8.5% output; overhead = tokenized SKILL.md size |
| fast-jev-compaction | ~~modeled~~ → Later | not modeled: see Decisions 2026-09-25 (M2) |
| codegraph | upper bound | exploratory Read/Grep/Glob tool output |
| context-mode | upper bound | tool outputs > 5,000 bytes → small excerpt |

## Decisions

- 2026-09-25 — Probe script `scripts/probe-schema.mjs` is committed so schema drift can be
  re-checked on any release; it prints structure only and masks non-identifier keys.
- 2026-09-25 — Claude dedupe takes the **max of each usage field** across copies of a
  `message.id|requestId` (input/cache differed in 6 keys, not 1); lines without
  `requestId` key on `message.id` alone.
- 2026-09-25 — Tokenizer: `gpt-tokenizer` o200k_base only, **bundled into dist at build
  time** (dev dependency) so the npx install stays small with zero runtime deps; ship its
  MIT notice. Revisit in M1 if bundling is awkward.
- 2026-09-25 — rtk replay covers only pipe filters whose expected input matches recorded
  human-format output; `git-status`/`git-log` are excluded from rtk coverage and the
  report says so (simpler and more honest than guessing a converted format).
- 2026-09-25 — Every external saver is called with its telemetry off and state redirected
  to a temp dir (`HEADROOM_BEACON=off DO_NOT_TRACK=1 HEADROOM_OFFLINE=1`,
  `CAVEMAN_HOME=<tmp>`), to keep the offline promise.
- 2026-09-25 — caveman skill modeled on JetBrains' measured −8.5% output (caveman itself
  no longer publishes a number).

- 2026-09-25 — Dollar figures are labelled "API-equivalent at list prices" in the report
  header, with a line saying it is not a subscription bill (logs don't record the plan).
- 2026-09-25 — Report tokens in "What that context was" count every re-read (a result
  read by 50 calls counts 50×), because that is what is billed. The header says so.
- 2026-09-25 — Calibration: Theil–Sen fit A = k·L + c per Claude model (≥30 pairs),
  else tokenizer family, else k = 1 flagged "uncalibrated". OpenAI models: k = 1.
- 2026-09-25 — Claude attachments counted as injected context; `prompt_snapshot`,
  `hook_success`, `structured_output` excluded (assumed not new prompt text; unverified).
- 2026-09-25 — Earlier assistant output (incl. thinking) is treated as re-read context;
  the calibration fit supports it (tech-notes §8.6).
- 2026-09-25 — Codex usage uses `token_count` with the ccusage dedupe rule everywhere;
  `token_usage_record` (v0.153+, 297 events here) is not used yet. Codex cache writes
  are assumed to be part of input and disjoint from cached reads (always 0 here).
- 2026-09-25 — Fast mode priced at 2× (Opus 5.5 and 5 list prices), US data residency
  1.1×, Codex `priority` tier 2×, `flex` 0.5×. None occur in the local logs.
- 2026-09-25 — Shell commands are reduced to fixed family labels (git, tests, build &
  lint, …); unknown programs become "other", so no command or script name can leak.
  MCP tools are grouped as "MCP tools" (server names can be private).
- 2026-09-25 — Package licence set to MIT in package.json (docs were silent; conventional
  for a popularity-driven CLI). Change before publishing if you prefer another.
- 2026-09-25 — Long non-space runs are tokenized in 400-char slices (≤ 1 extra token
  per slice) to keep counting linear.

- 2026-09-25 — Codex calls with no recorded service tier are priced as standard, not
  priority (ccusage assumes priority). Lower, and only what the log shows.

- 2026-09-25 (M2) — fast-jev-compaction moved to Later instead of modeled: it acts only at
  compaction, its decisions need the hosted Jev API, and keeping tool pairs likely adds
  tokens versus the built-in summary; a number would be mostly assumption. The report
  prints one line saying why it is absent.
- 2026-09-25 (M2) — Replayed savers run on a deterministic sample by default (rtk 20,000,
  caveman-engine 3,000, headroom 300 unique outputs), the rest extrapolated per class and
  labelled "sample N%". `--full-replay` for launch numbers. Keeps a first run bounded.
- 2026-09-25 (M2) — Replay cache at `$XDG_CACHE_HOME/saver-audit/replay-v1.json`
  (default `~/.cache/…`): content hashes and token counts only, no text.
- 2026-09-25 (M2) — caveman skill overhead = 1,650 o200k tokens of SKILL.md (v2.7.0,
  commit 880114a420) × k in every prompt; output cut 8.5% (JetBrains).
- 2026-09-25 (M2) — codegraph ceiling = all Read/Grep/Glob/ToolSearch output plus shell
  search, listing and file-reading families; context-mode ceiling = all outputs over
  5,000 bytes. Both assume the output disappears and nothing replaces it.
- 2026-09-25 (M2) — headroom marked not Codex-hypothetical (it is a proxy, not a hook).
  Verified 2026-09-25: headroom 0.38.0 `cli/wrap.py` has `headroom wrap codex`.
- 2026-09-25 (M2) — Added `--until` (not in the spec) so a fixed window can be re-run
  while new logs are being written; needed for the reproducibility check.

- 2026-09-25 (M3) — Card rasterizer: @resvg/resvg-wasm (MPL-2.0, unmodified, shipped
  with notice) + JetBrains Mono (OFL-1.1). Chosen over a hand-written PNG/bitmap-font
  renderer for legibility; costs +1.2 MB in the package; loaded only with `--card`.
- 2026-09-25 (M3) — The card never shows project names, even with `--show-projects`
  (simpler than the spec's allowance). It shows "sample N%" under sampled savers because
  the card travels without the report's notes.
- 2026-09-25 (M3) — Replay sample = first N outputs by hash plus every output already
  cached, so a `--full-replay` makes later default runs exact while two runs over the
  same logs stay identical.
- 2026-09-25 (M3) — README uses the founder's real run (2026-08-26 → 2026-09-25) and
  marks headroom as a 1% sample; the card image in `assets/readme-card.png` is from the
  same run (aggregates only).

- 2026-09-25 (M4) — HN and Reddit get fact sheets and briefs, not ready-to-paste text: HN
  bans AI-written or AI-edited posts, and several target subs ban LLM-written copy. X gets a
  draft marked "rewrite in your voice". Unverified X handles are not tagged.
- 2026-09-25 (0.3.0) — **Extends CLAUDE.md non-negotiable 1** ("no network at runtime,
  except --update-prices"): installing savers is a second explicit, user-requested
  exception (founder asked for one-step installs). It is announced before downloading,
  asks per item, and lives in a module the offline test allows by name and requires to be
  imported only on request. CLAUDE.md itself not edited; founder to confirm the wording.
- 2026-09-25 (0.2.0) — These five changes are beyond the original spec; built on the
  founder's explicit request. The default card goes to the current folder (not a hidden
  path) so people find it to share.
- 2026-09-25 (M4) — Copyright holder in LICENSE: "VladUZH" (the git user); change if you
  want your legal name.

## Human steps waiting (GATE)

- **Publish 0.4.0** from your own terminal: `cd ~/Documents/Programming/saver-audit && npm publish`.
- **Saver outreach**: send the messages in `docs/launch/saver-outreach.md` (edit in your
  voice; one per project; Discussions if enabled, else an issue).

- **Publish 0.3.0** from your own terminal: `cd ~/Documents/Programming/saver-audit &&
  npm publish`. Then try `npx saver-audit@0.3.0`, press `i`, and `s` once.

- **Publish 0.2.0** from your own terminal (Touch ID needs an interactive prompt):
  `cd ~/Documents/Programming/saver-audit && npm publish` (prepublishOnly runs checks).
  Then try `npx saver-audit@0.2.0` and press `s` once to check the X flow end to end.

- ~~Publish to npm~~ (done 2026-09-25, 0.1.0; see log). For the next release: run
  `npm publish` in your own terminal (passkey 2FA needs an interactive prompt).
- **Write the Show HN, Reddit posts and X thread yourself** from `docs/launch/` (HN and
  several subs ban AI-written text). Plan: Show HN Sunday 2026-10-04 12:00–14:00 UTC.

- ~~Delete one stray folder `~/.headroom`~~ (done by the founder 2026-09-25; verified gone).
- **headroom full replay: your OK needed** (about 30,000 outputs at up to ~1 s each on
  CPU, so possibly several hours of one busy core; cached afterwards). rtk and caveman are
  already fully replayed. Command, from the repo:
  ```
  T=~/.saver-audit-tools
  PATH=$T/bin:$PATH SAVER_AUDIT_HEADROOM_PYTHON=$T/headroom-venv/bin/python \
    HF_HOME=$T/hf XDG_CACHE_HOME=$T/cache node dist/cli.js --last 30d --full-replay
  ```
  Claude can run it; flagged here because headroom may take hours on CPU.

- ~~Create the public GitHub repo now~~ (done 2026-09-25, see log).
  Original instruction kept for reference:
- **Create the public GitHub repo now** (awesome-claude-code: 14 days since first commit
  or 100 stars). Repo `VladUZH/saver-audit` does not exist yet (checked 2026-09-25).
  Exact steps, from the project directory:
  ```
  gh repo create VladUZH/saver-audit --public --source . --remote origin \
    --description "Where your Claude Code and Codex tokens really go, and what token savers would cut" --push
  ```
  This pushes the current commits (docs + probe script; no logs). Review `git log` first.
- ~~Install the replayed savers~~ (done 2026-09-25 in `~/.saver-audit-tools`, see log).
  Original instruction:
  `brew install rtk`; `npm i -g @caveman-ai/cli && caveman setup --install`;
  `uv tool install "headroom-ai[ml]"` then pre-download its model once. Optional:
  `npm i -g ccusage` (or use `npx ccusage`) for the M1 1% cross-check. Your call:
  these are installs on your machine, so I have not run them.

## Later

- fast-jev-compaction: model only if a defensible method appears (needs compaction-level
  replay and the hosted decisions).
- headroom: replay whole conversations (not single outputs) to capture age-based
  compression of excluded tools.
- A setup helper for users: detect headroom without the Kompress model / onnxruntime and
  print the exact fix.

- Use Codex `token_usage_record` (per-response, v0.153+) when present.
- zstd-compressed Codex rollouts (`.jsonl.zst`, feature-flagged, none seen yet).
- Verify the three excluded Claude attachment types against Claude Code behaviour.
- Share token counts across workers (35% of tokenized text repeats across files).
