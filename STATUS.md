# STATUS — saver-audit

Append-only log. After every task: what was done, how it was verified (command + result),
what is blocked and why, and decisions made where the docs were silent.

## Current milestone

M0 — ground truth: **done** (acceptance met, see log 2026-09-25). Next: M1.
GATE open: create the public GitHub repo (below).

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
