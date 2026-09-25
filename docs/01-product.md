# 01 — Product

## Who it is for

Developers who use Claude Code or Codex every day and either already run a token saver
or are wondering whether to install one. The community is large and reachable:
r/ClaudeCode (about 395k members), r/vibecoding (about 343k), and the audiences of the
token-saver repos themselves (caveman 108k stars, rtk 82k, headroom 74k, codegraph 72k).
See `evidence-adoption-check.md`.

## The job

"Show me where my agent's tokens and money actually go, on my own work, and whether
any of these savers would help, and by how much."

The premise that savers save less than claimed is already public: a June r/LocalLLaMA
post replayed 500 Claude Code sessions through rtk, headroom and caveman and found 3.7%
combined; JetBrains and Quesma published counter-benchmarks, and each later "I
benchmarked N savers" post drew fewer upvotes. So saver-audit leads with the personal
question ("where do *my* tokens go?"), which does well on HN (Claude Code Usage Monitor
245 points, a proxy showing what LLM tools send 218), and treats the saver comparison as
the second half.

Today people choose token savers from README claims and HN threads. An independent test
measured rtk as about 5% cheaper on Claude and about 5% more expensive on DeepSeek
(https://news.ycombinator.com/item?id=49656471). Nobody can check on their own sessions.

## What the user sees

1. They run `npx saver-audit`.
2. The CLI finds their local Claude Code and Codex logs for the chosen period.
3. It prints:
   - **Where your tokens go:** prompts, tool outputs by tool (shell, file reads, search,
     web fetch…), assistant output, cache writes and reads, and cost per bucket.
   - **What each saver would have cut:** tokens and dollars, each with its method label
     (`replayed`, `modeled`, `upper bound`) and a confidence note.
   - **Your biggest waste:** e.g. "test logs in 3 projects: 7.9M tokens".
   - **The caveat:** offline replay can't show whether a saver changes agent behaviour.
4. `--card` writes a PNG share card with the headline numbers only.
5. `--json` gives everything machine-readable, so others can build on it.

## What it is not

- Not a token saver itself (a "suggest fixes" mode can come later).
- Not a live proxy, not a dashboard, no account, no telemetry.

## Why it can become popular

- It rides a live boom (token savers) and answers its most-argued question.
- Time to wow is seconds, with zero setup, on the user's own data.
- The share card and "what did you get?" comparisons spread it.
- It costs nothing to serve: everything runs on the user's machine.

## Risks (from the adoption check)

- The "savers don't save much" story is already told; lead with the personal "where do my
  tokens go" view.
- Claude Code's log format is officially internal and changes between versions; parsing
  must be defensive and releases quick. Most users keep only 30 days of history.
- Popularity may spike and fade with the token-saver wave. Treat the launch as a way to
  build an audience for the next two bets.
- Anthropic keeps building savings into Claude Code, which changes the baseline.
- Savers change quickly; adapters must be easy to update.

## Later (not in the weekend build)

A Mac menu-bar version (Swift) that shows savings live; "suggest fixes" (e.g. the
`.claudeignore` or test-log changes that would have saved the most); support for more
agents (Cursor, Gemini CLI, OpenCode) if their logs are local and documented.
