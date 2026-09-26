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
  - `s` opens a post on X with your savings filled in and puts the card on your clipboard, so you paste it (⌘V / Ctrl+V) and post. X links can't attach images, so the card goes via the clipboard. saver-audit uploads nothing; your browser opens x.com only when you press `s`. If no browser opens, it prints the link instead.
  - `e` appears when some outputs are not measured yet. It gives exact numbers (see below).
  - `i` appears when a saver is missing and can be installed on this machine. It installs the savers so you get measured numbers instead of estimates (see below), then re-runs.
- **Without the key menu** (with `--short`, or when input is not a terminal), the short view names the flags instead: `--exact` and `--install-savers`.

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
| Earlier assistant turns, re-read (incl. thinking) | $1,097 | 26% |
| Tool output: shell | $710 | 17% |
| System prompt and tool definitions (not in the logs) | $698 | 17% |
| Reminders, attachments, command output | $526 | 12% |
| Assistant output | $520 | 12% |
| Tool output: web fetch | $202 | 5% |

**What each saver would have cut:**

| Saver | Method | Could touch | Saved | Of the bill |
|---|---|---|---|---|
| [rtk](https://github.com/rtk-ai/rtk) 0.50.0 | replayed (all 3,291 outputs), lower bound | 6% of tool output | $21 | 0.5% |
| [caveman](https://github.com/JuliusBrussee/caveman) proxy engine | replayed (every output of 500+ tokens) | all tool output | $13 | 0.3% |
| [headroom](https://github.com/headroomlabs-ai/headroom) 0.38.0 | replayed (every output of 200+ tokens), lower estimate | 56% | $151 | 3.6% |
| [lean-ctx](https://github.com/yvgude/lean-ctx) 3.10.3 | replayed (every output of 500+ tokens) | 64% | $126 | 3.0% |
| [token-saver](https://github.com/ppgranger/token-saver) 3.0.0 | replayed (every output of 500+ tokens) | 48% | $66 | 1.6% |
| caveman skill | modeled: −8.5% output (JetBrains), SKILL.md in every prompt | output | $96 | 2.3% |
| [codegraph](https://github.com/colbymchenry/codegraph) | upper bound | 43% | ≤ $578 | ≤ 13.7% |
| [context-mode](https://github.com/mksglu/context-mode) | upper bound | 61% | ≤ $704 | ≤ 16.7% |

The two biggest items are things no tool-output saver touches:
- **Re-reading earlier turns:** about a quarter of the cost is earlier assistant turns, thinking included, read again from cache on every call.
- **The fixed system prompt and tool definitions:** another 17%.

The headroom number is a lower estimate (see below). On Codex alone, where shell output is 44% of the cost, headroom would cut 10.4% and rtk at least 2.1% (token-saver 12.4% and lean-ctx 7.8%, but they work through Claude Code hooks, so those figures are hypothetical).

## What the labels mean

- **replayed.** saver-audit sends the recorded tool output through *your installed copy* of the saver and counts what is left, measured against what the model actually saw.
  - For example, Claude Code cuts large Bash output down to a preview, so that preview is the baseline.
  - **Quick by default:**
    - A normal run gives each saver a few seconds; the first run on a busy month takes about 20 s, later runs about 9 s.
    - rtk replays up to about 12,000 distinct outputs in its 15 s (the author's month had 3,291), so its number is usually **exact**. Past that, or on a machine too slow to finish in 15 s, the rest is estimated and marked **indicative**.
    - token-saver and lean-ctx are estimated from a sample and marked **indicative**. Larger outputs are more likely to be picked, since that is where savings are.
    - Each estimate comes with its own likely range, ±X%: two standard errors, in tokens. On the author's month it was ±33% for token-saver and ±17% for lean-ctx. Dollars weight outputs differently, so they can be off by more.
    - With fewer than 20 sampled outputs to estimate from, they show no number until you ask for exact numbers.
    - The caveman engine and headroom show "—" until you ask for exact numbers: a quick sample was too far off for them.
    - A replay that fails counts as unchanged, is not cached, and is tried again next run. A number with failed replays is marked **indicative**. When most replays fail, the saver shows "not measured" and why, for example headroom without its model.
  - **Exact on request:** press `e` or pass `--exact`.
    - It replays every output above each saver's size floor: caveman, token-saver and lean-ctx 500 tokens, headroom 200.
    - `e` first shows how long that will take on your logs. headroom can take hours on a busy month, so `e` asks about it separately.
    - `--exact` asks nothing: it replays every saver, headroom included. To leave headroom out, list the others with `--savers`.
    - Results are saved as it goes, so you can stop with Ctrl+C and the next run carries on.
    - Results are cached and count as exact in later quick runs. Outputs new since then are sampled again; for the caveman engine and headroom, they wait for the next exact run.
    - The floors make caveman about 5%, token-saver about 9% and lean-ctx about 1% low, and the report says so.
- **modeled.** An estimate from a published measurement, with the assumption printed next to it.
- **upper bound.** The saver changes how the agent behaves (which tools it calls), so replay can only give a ceiling: everything it could possibly remove.

Offline replay can't show whether a saver changes how the agent behaves: extra turns, retries, recalls, answer quality. The report says so every time.

## How the dollars are computed

- **Recorded usage is the truth.** Claude usage is deduplicated per API response (`message.id` + `requestId`, max per field). Codex `token_count` events are deduplicated, and history replayed into forked threads is skipped. Both match [ccusage](https://github.com/ccusage/ccusage) to the token on the author's logs. One rule goes further than ccusage: in a forked Codex thread, a lone usage event within 1 s of the thread's start is the parent's call replayed, so it is not billed again.
- **Rewinds.** When you rewind or edit an earlier prompt in Claude Code, the calls after it start from the conversation you kept. The abandoned branch is still billed, but it no longer counts as context, and savers get no credit for it.
- **Cache-aware savings.** A token removed from a tool output is priced as a cache write when it is first sent. It is then priced as a cache read on every later call until the next compaction, using each call's recorded cache pattern.
- **Token counts.** Per-block token counts use `o200k_base`, calibrated per Claude model against the usage in your own logs. Claude 4.7+ comes out at about 1.5× o200k on the author's logs, and the fit quality is printed. For OpenAI models, o200k is the tokenizer itself.
  - Claude 3.x models share the calibration of the older Claude tokenizer (4.6 and earlier). A Claude model saver-audit doesn't know is fitted on its own, or shown as uncalibrated.
  - Older Claude models (Opus 4.1, Sonnet 4.5, Haiku 4.5 and earlier) drop earlier thinking at each new prompt, so there it stops counting as re-read context.
- **Prices.** Prices are a bundled, dated snapshot of [models.dev](https://models.dev) (1-hour cache writes at 2× input). LiteLLM fills in the models models.dev lacks, such as retired ones, and the >200k-token rates of Sonnet 4.5 and 4. `--update-prices` fetches a fresh list and lays it over the bundled one, so a model missing from the update keeps its bundled price, and so does a Claude >200k-token rate the update lacks (for example when the LiteLLM fetch fails).
  - Fast mode is priced per model: 6× on Opus 4.6 and 4.7, 2× on Opus 4.8, 5 and 5.5. A fast call on a model with no published fast price gets the standard rate, and the full report says so.
  - A dated model id such as `gpt-5-2025-08-07` is priced as its base model.
  - A model with no price counts its tokens at $0, and the total says how many calls that leaves out.
  - Codex web searches are not in the total: the price list has no OpenAI per-search fee. The total says how many searches that leaves out.

## Privacy

- **The report:** it never prints prompts, code, file contents, commands or tool output. Shell commands are reduced to fixed labels ("tests", "git"…), and project names are hidden unless you pass `--show-projects`.
- **The share card (`--card`):** it holds numbers, model names and dates only. It replaces any file or link at its path; it never writes through a link.
- **The replay cache** (`~/.cache/saver-audit/replay-v1.json`, or under `$XDG_CACHE_HOME` when that is an absolute path): it stores content hashes and token counts, never text.
- **Savers:**
  - They run with their telemetry off and in an empty working folder. Their state goes to a temporary folder, which is removed at the end, and on Ctrl+C.
  - Your own `CAVEMAN_*` and `TOKEN_SAVER_*` settings are left out, and token-saver and lean-ctx get a temporary home.
  - They can't reach the network: web requests go to a local port where nothing listens.
  - On Windows, lean-ctx can still find your real profile folder, so the installer doesn't offer it there. A lean-ctx you installed yourself is still replayed.

## Options

```
saver-audit [--last 30d | --since 2026-09-01] [--until 2026-09-25] [--source claude-code|codex|all]
            [--exact] [--full | --short | --json] [--card [path] | --no-card] [--no-animation]
            [--install-savers [--with-headroom] [--yes]] [--check-saver <manifest.json>]
            [--show-projects] [--update-prices]
            [--savers rtk,caveman-engine,token-saver,lean-ctx,headroom,caveman-skill,codegraph,context-mode]
            [--no-savers] [--verbose]
```

In a terminal the default is the short view with the key menu, plus a card. When piped (or in CI) you get the full report and no card unless you pass `--card`.

**The period** ends at `--until`, or now. A date means the end of that day, which is included. `--last` counts back from that end, so `--last 7d --until 2026-09-22` is the 7 days up to the end of 22 September. `--since` replaces `--last`. Dates are `YYYY-MM-DD` (leading zeros optional) or a date with a time, such as `2026-09-20T10:00`, in local time. A `--since` after `--until` is an error.

## Installing the savers (one command)

To get *measured* numbers for rtk, the caveman engine, token-saver, lean-ctx and headroom, they have to be on your machine: saver-audit runs your copy and never bundles saver code (caveman's engine is BSL-1.1).

```
npx saver-audit --install-savers                  # rtk, caveman engine, token-saver, lean-ctx: ~56 MB
npx saver-audit --install-savers --with-headroom  # + headroom, its model and tokenizer: ~1.6 GB, minutes, Python 3.10+ with venv
```

Or press `i` in the short view.
- **Where from:**
  - rtk, the caveman engine, token-saver and lean-ctx: each saver's official GitHub release, pinned to the version the adapters were written for, and verified before use. rtk and lean-ctx are checked against their release checksums, the caveman engine against checksums signed with caveman's key, and token-saver against a hash pinned in saver-audit.
  - headroom: `headroom-ai` 0.38.0 from PyPI (pip chooses its dependencies), its model from Hugging Face, and its tokenizer through tiktoken. saver-audit does not pin or verify these downloads, and says so before it asks.
- **Where to:** `~/.saver-audit/tools`. No saver's own setup runs, so your Claude Code and Codex settings stay as they are. Delete the folder to uninstall.
- **What it asks:** before each download, unless you pass `--yes`. Without a terminal and without `--yes`, it installs nothing and says so. The report follows either way; the exit code is 1 only if an install failed.
- **Where it can't:** token-saver needs Python 3.10+, and its installer supports macOS and Linux; lean-ctx is not offered on Windows (see Privacy). rtk and lean-ctx are installed on x64 and arm64 CPUs only. A download that does not run on your machine is not installed.
- **Older copies:** if the rtk, token-saver or lean-ctx found is older than the version saver-audit was written for, the installer offers the current one. The caveman engine has no version flag, so an older engine is not noticed.

If you already have a saver installed yourself, saver-audit uses that. It looks in your `PATH`'s absolute folders, then in `~/.saver-audit/tools/bin`, then (for the caveman engine) in `~/.caveman/bin`. For rtk, token-saver and lean-ctx it takes the first copy that is not older than the version its adapter was written for (or the first one found, if none is current). For the caveman engine it takes the first one found, whatever its version, so an engine on your `PATH` comes before the one `--install-savers` verified. An override variable always wins; a relative path in one (`./bin/rtk`) is taken from the folder you run saver-audit in.

- **rtk:** `rtk` on your `PATH`, or set `SAVER_AUDIT_RTK`.
- **caveman engine:** `caveman-engine` on your `PATH` or in `~/.caveman/bin`, or set `CAVEMAN_ENGINE_BIN`.
- **token-saver, lean-ctx:** on your `PATH`, or set `SAVER_AUDIT_TOKEN_SAVER` / `SAVER_AUDIT_LEAN_CTX`.
- **headroom:** a `headroom` install with the `[ml]` extra, its Kompress model and tiktoken's `o200k_base` downloaded (run headroom once online), or set `SAVER_AUDIT_HEADROOM_PYTHON`. An audit never downloads them. On Windows, saver-audit follows pip's `headroom.exe` launcher to its Python; if that fails, set `SAVER_AUDIT_HEADROOM_PYTHON`. headroom leaves Read/Grep/Glob/Edit/Write/web output alone while it is recent and compresses it as it ages. saver-audit replays each output as the newest message, so its headroom number is a lower estimate.

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

Early release (0.6.0). Requires Node ≥ 20. Issues and share cards welcome. MIT licence; bundled third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
