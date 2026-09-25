# saver-audit

**Where your Claude Code and Codex tokens really go, priced with prompt-cache costs, and what each token saver would actually cut on your own sessions.** One command, fully offline.

```
npx saver-audit
```

![saver-audit share card: 30 days of the author's own sessions](https://raw.githubusercontent.com/VladUZH/saver-audit/main/assets/readme-card.png)

saver-audit reads the session logs that Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`) already keep on your machine. It then prints three things:

- **What you spent.** Your deduplicated usage, priced at list prices, including cache writes and cache reads.
- **What that context was.** Tool output by tool, earlier turns being re-read, the system prompt, your prompts.
- **What each popular token saver would have cut** from those same sessions. Every number is labelled with how it was obtained.

Nothing leaves your machine. The network is used only when you ask: `--update-prices`, installing savers (`--install-savers` or `i`), and `s` opening X in your browser.

**In a terminal:**
- **Short view:** you get one screen with your total, where it went, and what each saver would cut.
- **Share card:** `saver-audit.png` is written next to you. It holds numbers only.
- **Keys:**
  - `f` shows the full report;
  - `o` opens the card;
  - `s` opens a post on X with your savings filled in and puts the card on your clipboard, so you paste it (⌘V / Ctrl+V) and post. X links can't attach images, so the card goes via the clipboard. saver-audit uploads nothing; your browser opens x.com only when you press `s`.
  - `i` appears when a saver isn't installed yet. It installs the savers so you get measured numbers instead of estimates (see below), then re-runs.

![saver-audit running on the author's logs](https://raw.githubusercontent.com/VladUZH/saver-audit/main/assets/demo.gif)

## Results on the author's own logs

30 days of the author's own work (2026-08-26 → 2026-09-25):
- 54 sessions and 813 subagent runs;
- 35,664 API calls;
- Claude Code and Codex.

**$4,209 API-equivalent** at list prices. That is what the same tokens cost through the API, not a bill; on a subscription you pay the plan price:

| Billed as | Cost | Share |
|---|---|---|
| Cache reads | $2,326 | 55% |
| Cache writes | $1,328 | 32% |
| Output (incl. thinking) | $520 | 12% |
| Uncached input | $36 | 1% |

**What that context was.** These are estimates; a token re-read by 50 calls counts 50 times.

| Content | Cost | Share |
|---|---|---|
| Earlier assistant turns, re-read (incl. thinking) | $1,090 | 26% |
| Tool output: shell | $711 | 17% |
| System prompt and tool definitions (not in the logs) | $687 | 16% |
| Reminders, attachments, command output | $546 | 13% |
| Assistant output | $520 | 12% |
| Tool output: web fetch | $202 | 5% |

**What each saver would have cut:**

| Saver | Method | Could touch | Saved | Of the bill |
|---|---|---|---|---|
| [rtk](https://github.com/rtk-ai/rtk) 0.50.0 | replayed (all 5,513 outputs) | 15% of tool output | $47 | 1.1% |
| [caveman](https://github.com/JuliusBrussee/caveman) proxy engine | replayed (every output of 500+ tokens) | all tool output | $13 | 0.3% |
| [headroom](https://github.com/headroomlabs-ai/headroom) 0.38.0 | replayed (all ~30k outputs), lower estimate | 56% | $151 | 3.6% |
| [lean-ctx](https://github.com/yvgude/lean-ctx) 3.10.3 | replayed (every output of 1,000+ tokens) | 67% | $122 | 2.9% |
| [token-saver](https://github.com/ppgranger/token-saver) 3.0.0 | replayed (every output of 1,000+ tokens) | 51% | $65 | 1.5% |
| caveman skill | modeled: −8.5% output (JetBrains), SKILL.md in every prompt | output | $95 | 2.3% |
| [codegraph](https://github.com/colbymchenry/codegraph) | upper bound | 43% | ≤ $579 | ≤ 13.8% |
| [context-mode](https://github.com/mksglu/context-mode) | upper bound | 61% | ≤ $704 | ≤ 16.7% |

The two biggest items are things no tool-output saver touches:
- **Re-reading earlier turns:** about a quarter of the cost is earlier assistant turns, thinking included, read again from cache on every call.
- **The fixed system prompt and tool definitions:** another 16%.

The headroom number is a lower estimate (see below). On Codex alone, where shell output is 44% of the cost, headroom would cut 10.4% and rtk 4.1% (token-saver 12.0%, but it works through Claude Code hooks, so that figure is hypothetical).

## What the labels mean

- **replayed.** saver-audit sends the recorded tool output through *your installed copy* of the saver and counts what is left, measured against what the model actually saw.
  - For example, Claude Code cuts large Bash output down to a preview, so that preview is the baseline.
  - rtk, the caveman engine, token-saver and lean-ctx replay every output above a size floor (caveman 500 tokens, token-saver and lean-ctx 1,000). Samples were checked against full replays and missed by up to 40%, so they're not used for these. The floors make caveman about 5%, token-saver about 10% and lean-ctx about 4% low, and the report says so. headroom, which runs an ML model per output, replays a sample of 300 by default and says so; `--full-replay` replays everything. Results are cached.
- **modeled.** An estimate from a published measurement, with the assumption printed next to it.
- **upper bound.** The saver changes how the agent behaves (which tools it calls), so replay can only give a ceiling: everything it could possibly remove.

Offline replay can't show whether a saver changes how the agent behaves: extra turns, retries, recalls, answer quality. The report says so every time.

## How the dollars are computed

- **Recorded usage is the truth.** Claude usage is deduplicated per API response (`message.id` + `requestId`, max per field). Codex `token_count` events are deduplicated, and history replayed into forked threads is skipped. Both match [ccusage](https://github.com/ccusage/ccusage) to the token on the author's logs.
- **Cache-aware savings.** A token removed from a tool output is priced as a cache write when it is first sent. It is then priced as a cache read on every later call until the next compaction, using each call's recorded cache pattern.
- **Token counts.** Per-block token counts use `o200k_base`, calibrated per Claude model against the usage in your own logs. Claude 4.7+ comes out at about 1.5× o200k on the author's logs, and the fit quality is printed. For OpenAI models, o200k is the tokenizer itself.
- **Prices.** Prices are a bundled, dated snapshot of [models.dev](https://models.dev) (1-hour cache writes at 2× input). `--update-prices` fetches a fresh one.

## Privacy

- **The report:** it never prints prompts, code, file contents, commands or tool output. Shell commands are reduced to fixed labels ("tests", "git"…), and project names are hidden unless you pass `--show-projects`.
- **The share card (`--card`):** it holds numbers, model names and dates only.
- **The replay cache** (`~/.cache/saver-audit/replay-v1.json`): it stores content hashes and token counts, never text.
- **Savers:** they run with their telemetry off and their state in a temporary folder.

## Options

```
saver-audit [--last 30d | --since 2026-09-01] [--until 2026-09-25] [--source claude-code|codex|all]
            [--full | --short | --json] [--card [path] | --no-card] [--no-animation]
            [--install-savers [--with-headroom] [--yes]] [--check-saver <manifest.json>]
            [--show-projects] [--update-prices]
            [--savers rtk,caveman-engine,headroom,caveman-skill,codegraph,context-mode]
            [--no-savers] [--full-replay] [--verbose]
```

In a terminal the default is the short view with the key menu, plus a card. When piped (or in CI) you get the full report and no card unless you pass `--card`.

## Installing the savers (one command)

To get *measured* numbers for rtk, the caveman engine, token-saver, lean-ctx and headroom, they have to be on your machine: saver-audit runs your copy and never bundles saver code (caveman's engine is BSL-1.1).

```
npx saver-audit --install-savers                  # rtk, caveman engine, token-saver, lean-ctx: ~56 MB, seconds
npx saver-audit --install-savers --with-headroom  # + headroom and its model: ~1.6 GB, minutes, Python 3.10+
```

Or press `i` in the short view.
- **Where from:** each saver's official GitHub release, pinned to the version the adapters were written for, and verified before use: rtk against its release checksums, the caveman engine against checksums signed with caveman's key.
- **Where to:** `~/.saver-audit/tools`. No saver's own setup runs, so your Claude Code and Codex settings stay as they are. Delete the folder to uninstall.
- **What it asks:** before each download, unless you pass `--yes`.

If you already have a saver installed yourself (on your `PATH`), saver-audit uses that.

- **rtk:** `rtk` on your `PATH`.
- **caveman engine:** `caveman-engine` on your `PATH` or in `~/.caveman/bin`, or set `CAVEMAN_ENGINE_BIN`.
- **headroom:** a `headroom` install with the `[ml]` extra and its Kompress model downloaded, or set `SAVER_AUDIT_HEADROOM_PYTHON`. headroom leaves Read/Grep/Glob/Edit/Write/web output alone while it is recent and compresses it as it ages. saver-audit replays each output as the newest message, so its headroom number is a lower estimate.

## Add your saver

A saver is one JSON file. If your tool can filter a tool output from stdin, saver-audit can measure it on every user's own logs. See [CONTRIBUTING.md](CONTRIBUTING.md) and `npx saver-audit --check-saver my-saver.json`. You can also drop a manifest into `~/.saver-audit/savers/` to try it privately. Suggestions: [open a "Saver" issue](https://github.com/VladUZH/saver-audit/issues/new?template=add-a-saver.yml).

`fast-jev-compaction` is not included. It acts only at compaction, and its decisions need its hosted API.

## Credit

The "savers save less than claimed" question isn't new. saver-audit builds on earlier work:
- an [r/LocalLLaMA replay of 500 sessions](https://www.reddit.com/r/LocalLLaMA/comments/1u9anzk/);
- [JetBrains'](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) and [Quesma's](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/) rtk benchmarks;
- [ccusage](https://github.com/ccusage/ccusage)'s parsing rules.

What saver-audit adds:
- one command on *your own* logs;
- Claude Code and Codex together;
- savings priced against the prompt cache;
- a method label on every number.

## Status

Early release (0.5.0). Requires Node ≥ 20. Issues and share cards welcome. MIT licence; bundled third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
