# STATUS — saver-audit

Append-only log. After every task: what was done, how it was verified (command + result),
what is blocked and why, and decisions made where the docs were silent.

## Current milestone

M2 — saver adapters: **done** (acceptance met, see log 2026-09-25). Next: M3 (share card, README).
Launch numbers still need one `--full-replay` run (see Human steps).

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
- 2026-09-25 (M2) — headroom marked not Codex-hypothetical (it is a proxy, not a hook);
  unverified whether `headroom wrap` supports Codex.
- 2026-09-25 (M2) — Added `--until` (not in the spec) so a fixed window can be re-run
  while new logs are being written; needed for the reproducibility check.

## Human steps waiting (GATE)

- **Delete one stray folder** (my delete was blocked): `rm -rf ~/.headroom` — it holds only
  `ccr_store.db`, created 2026-09-25 16:10 by my headroom test.
- **Before writing launch copy: one full replay** (slow; cached afterwards). From the repo:
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
