# STATUS — saver-audit

Append-only log. After every task: what was done, how it was verified (command + result),
what is blocked and why, and decisions made where the docs were silent.

## Current milestone

M1 — where your tokens go: **done** (acceptance met, see log 2026-09-25). Next: M2.
GATE still open: create the public GitHub repo (below).

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

### Savers in scope for the launch (M0 acceptance)

| Saver | Class | Condition |
|---|---|---|
| rtk | replayed (partial) | `rtk pipe --filter`, Bash outputs only; git status/log excluded (format mismatch) |
| caveman engine | replayed | user's own `caveman-engine` binary; skip with note if absent |
| headroom | replayed | user's own `headroom-ai[ml]` with cached model, offline + beacon off; skip with note otherwise |
| caveman skill | modeled | JetBrains −8.5% output; overhead = tokenized SKILL.md size |
| fast-jev-compaction | modeled | range: built-in summary / 300-char cut / drop all non-pinned pairs |
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

## Human steps waiting (GATE)

- **Create the public GitHub repo now** (awesome-claude-code: 14 days since first commit
  or 100 stars). Repo `VladUZH/saver-audit` does not exist yet (checked 2026-09-25).
  Exact steps, from the project directory:
  ```
  gh repo create VladUZH/saver-audit --public --source . --remote origin \
    --description "Where your Claude Code and Codex tokens really go, and what token savers would cut" --push
  ```
  This pushes the current commits (docs + probe script; no logs). Review `git log` first.
- **Install the replayed savers before the M2 real-log run** (none are installed here):
  `brew install rtk`; `npm i -g @caveman-ai/cli && caveman setup --install`;
  `uv tool install "headroom-ai[ml]"` then pre-download its model once. Optional:
  `npm i -g ccusage` (or use `npx ccusage`) for the M1 1% cross-check. Your call:
  these are installs on your machine, so I have not run them.

## Later

- Use Codex `token_usage_record` (per-response, v0.153+) when present.
- zstd-compressed Codex rollouts (`.jsonl.zst`, feature-flagged, none seen yet).
- Verify the three excluded Claude attachment types against Claude Code behaviour.
- Share token counts across workers (35% of tokenized text repeats across files).
