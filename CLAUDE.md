# saver-audit — instructions for Claude Code

You are building **saver-audit**, launch bet 1 of 3. Read this file, then `docs/` in
numeric order, then `docs/tech-notes.md` (§0 changes the build) and
`docs/evidence-adoption-check.md`.
`docs/one-pager.html` is the visual pitch.

## The one-paragraph product

`npx saver-audit` reads a developer's own Claude Code and Codex session logs on
their machine and shows **where their agent's tokens and dollars really go**, priced
with prompt-cache costs, and then **what each popular token saver** (rtk, caveman,
headroom, codegraph and the like) would really cut on those sessions. It works fully
offline, labels how every number was obtained, and writes a share card that contains
numbers only. Four token-saver repos passed 70k GitHub stars each in 2026, but
"savers don't save much" has already been posted and benchmarked (an r/LocalLLaMA
replay of 500 sessions found 3.7%; JetBrains and Quesma published counter-benchmarks).
What is new here: one command on *your own* logs, Claude Code and Codex together,
cache-aware pricing, and honest method labels. The goal is **popularity** (GitHub stars, npx runs, share cards posted), not
revenue.

## Non-negotiables

1. **Offline by default.** No network calls at runtime. The only exception is an
   explicit `--update-prices` flag that fetches a public price list, and it says so.
   Add a test that fails if runtime code imports an HTTP client or calls `fetch`.
2. **Nothing private leaves the report.** Never print prompts, code, file contents
   or tool output. The share card holds numbers, model names and dates only: no paths,
   no project names unless the user passes `--show-projects`.
3. **Honest methods.** Every saver result is labelled `replayed` (a deterministic
   transform applied to recorded text), `modeled` (an estimate, with the assumption
   stated) or `upper bound` (the saver changes agent behaviour, so only a ceiling can be
   given). Measure against what the model actually saw (Claude Code truncates large Bash
   output to a preview), not the raw command output. The report always states that offline replay
   cannot show whether a saver changes how the agent behaves.
4. **No invented numbers** in docs, README, fixtures or launch copy. Launch numbers
   come from real runs on the founder's own logs.
5. **Test fixtures are synthetic.** Never commit real session logs or anything from
   `~/.claude` or `~/.codex`.
6. **Respect saver licences.** Don't bundle BSL or Elastic-licensed code (caveman's
   engine/proxy is BSL-1.1, context-mode is Elastic 2.0). Replay by calling the user's
   own installed binary, and skip that saver with a clear note if it isn't installed.
7. **Weekend scope first.** Ship M0–M3 in `docs/03-work-plan.md` before adding anything.
   Anything not in the spec goes to "Later" in `STATUS.md`.

## How to work

- Work milestone by milestone (`docs/03-work-plan.md`). Each milestone has acceptance
  checks; run them for real and paste command + result into `STATUS.md`.
- **Keep `STATUS.md` current** after every task: done, verified how, blocked, and
  decisions made where the docs were silent. Append; don't rewrite history.
- **Gates need the human** (marked GATE): publishing to npm, creating the public GitHub
  repo, posting anywhere, emailing anyone. Prepare everything up to the gate, write the
  exact instruction in `STATUS.md`, continue with other work.
- When the docs are silent, choose the simpler, more honest, more local option and log
  it under "Decisions" in `STATUS.md`.
- Commit small, one concern per commit, conventional messages (`feat(parser): …`).
- Stack: TypeScript, Node ≥ 20, ESM, zero or near-zero runtime dependencies. Tests with
  `node --test` or vitest. Keep the install tiny: `npx` users wait for every dependency.

## Commands (target state)

```
npm install
npm test                         # unit + golden tests on synthetic fixtures
npm run build
node dist/cli.js --last 30d      # run on the local machine's real logs
node dist/cli.js --json          # machine-readable output
node dist/cli.js --card          # write saver-audit.png
```

## What "done" looks like for the launch

`npx saver-audit` runs on a fresh Mac/Linux machine in under 10 seconds for a month of
logs, prints the report, writes the share card, and the README shows the founder's
real measured results. The Show HN draft and channel posts in `docs/04-launch.md` are
filled in with those real numbers, waiting for the human to post.
