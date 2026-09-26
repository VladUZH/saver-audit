# Show HN fact sheet (for the founder to write from)

**HN bans AI-written or AI-edited posts and comments** ([guidelines](https://news.ycombinator.com/newsguidelines.html), [dang's Show HN tips](https://news.ycombinator.com/item?id=22336638)). This file holds facts, numbers and likely questions only. Write the title, the post and every reply yourself.

Every number below comes from one run on the founder's own logs:

```
node dist/cli.js --since 2026-08-26 --until 2026-09-25T13:00:00 --json
```

rtk, the caveman engine and headroom were all fully replayed.

## The numbers

### Dataset

| Item | Value |
|---|---|
| Period | 30 days, 2026-08-26 → 2026-09-25 |
| Agents | Claude Code (34 sessions) + Codex (20 sessions) |
| Subagent runs | 813 |
| API calls | 35,664, deduplicated |
| Tokens billed | 6.47B, cache reads included |
| Cost | **$4,209 API-equivalent** at list prices. This is not a bill; on a subscription you pay the plan price |

### Where the money went

| Billed as | Cost | Share |
|---|---|---|
| Cache reads | $2,326 | 55% |
| Cache writes | $1,328 | 32% |
| Output (incl. thinking) | $520 | 12% |
| Uncached input | $36 | 1% |

### What the context was (estimated)

| Content | Cost | Share |
|---|---|---|
| Earlier assistant turns re-read, thinking included | $1,097 | 26% |
| Shell tool output | $710 | 17% |
| System prompt and tool definitions (not in the logs) | $698 | 17% |
| Reminders, attachments, command output | $526 | 12% |
| Web fetch output | $202 | 5% |

### What each saver would have cut, same sessions

| Saver | Method | Could touch | Saved | Of the bill |
|---|---|---|---|---|
| rtk 0.50.0 | replayed, all 3,291 outputs; a lower bound (its hook also rewrites commands with no offline filter) | 6% of tool output | $21 | 0.5% |
| caveman proxy engine | replayed, every output of 500+ tokens | all tool output | $13 | 0.3% |
| headroom 0.38.0 | replayed, every output of 200+ tokens; a lower estimate | 56% | $151 | 3.6% |
| lean-ctx 3.10.3 | replayed, every output of 500+ tokens (~1% low) | 64% | $126 | 3.0% |
| token-saver 3.0.0 | replayed, every output of 500+ tokens (~9% low) | 48% | $66 | 1.6% |
| caveman skill | modeled: −8.5% output (JetBrains), SKILL.md in every prompt | output | $96 | 2.3% |
| codegraph | upper bound (it changes agent behaviour) | 43% | ≤ $578 | ≤ 13.7% |
| context-mode | upper bound (it changes agent behaviour) | 61% | ≤ $704 | ≤ 16.7% |

### The Codex-only cut (same window)

| Item | Value |
|---|---|
| Sessions | 20 |
| API calls | 792 |
| Cost | $125 |
| Largest content bucket | Shell output, $55 (44%) |
| headroom | $13.06 (10.4% of the Codex bill) |
| lean-ctx | $9.81 (7.8%, hypothetical on Codex) |
| token-saver | $15.51 (12.4%, hypothetical on Codex: it works through Claude Code hooks) |
| rtk | $2.59 (2.1% of the Codex bill; a lower bound) |
| caveman engine | $0.59 |
| codegraph ceiling | ≤ $19.51 |
| context-mode ceiling | ≤ $48.40 |

Caveman and context-mode can only *deny* on Codex, not rewrite, so their Codex numbers are hypothetical.

### Candidate surprises (pick one; only what the data shows)

- About a quarter of the cost is **earlier turns being re-read from cache**, thinking included. No tool-output saver touches that.
- **Measured savers cut 0.3–3.6% of the bill** (headroom 3.6%, lean-ctx 3.0%, token-saver 1.6%, rtk at least 0.5%, caveman engine 0.3%; caveman skill 2.3% modeled). Ceilings for the behaviour-changing tools are ~14–17%, but those are best cases, not measurements.
- **On Codex, shell output is 44% of the cost**: headroom would cut 10.4% of the Codex bill and rtk at least 2.1%. On Claude Code, shell output is 16%, and headroom cuts 3.4%.
- **Cache writes are about a third of the cost.** (Inference, not measured: a saver that removes tokens saves most when it removes them *before* the first cache write.)

## Method, in one breath each

**Totals are recorded usage.**
- Claude responses are deduplicated per `message.id` + `requestId`, taking the max per field.
- Codex `token_count` events are deduplicated, and the parent history replayed into forked threads is skipped.
- Both match ccusage to the token on these logs. That check found a double-counting bug of mine, now fixed.

**Savings are cache-aware.**
- A token removed from a tool output is priced as a cache write when first sent, then as a cache read on every later call until compaction, using each call's recorded cache pattern.

**Baselines are what the model saw.**
- Claude Code cuts Bash output over 30k characters down to a preview, so the preview is the baseline.
- rtk gets the full output, because it runs before Claude Code does.

**Three method labels.**
- **replayed** = your installed binary run over the recorded text.
- **modeled** = a published measurement plus a stated assumption.
- **upper bound** = the saver changes agent behaviour, so only a ceiling can be given.

**Token counts.**
- Counts use o200k_base, calibrated per Claude model against the logged usage. Claude 4.7+ comes out at about 1.5× o200k here, a good fit on thousands of pairs.
- For OpenAI models, o200k is the tokenizer itself.

**Offline.**
- The only network call is `--update-prices`, and a test fails if runtime code calls the network.
- Savers run with their telemetry off.

## What is new versus earlier work (credit it)

**Earlier work:**
- An r/LocalLLaMA post replayed 500 Claude Code sessions: headroom 2.8%, rtk 0.5%, caveman 0.4%, 3.7% combined ([1u9anzk](https://www.reddit.com/r/LocalLLaMA/comments/1u9anzk/)).
- Counter-benchmarks by [JetBrains](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) and [Quesma](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/).

**What saver-audit adds:**
- one command on *your own* logs;
- Claude Code and Codex together;
- dollars priced against the prompt cache;
- a method label on every number;
- a share card.

**Earlier HN threads to link:**
- [49656471](https://news.ycombinator.com/item?id=49656471) (Quesma rtk)
- [48588755](https://news.ycombinator.com/item?id=48588755) (Token Compression Illusion)
- [47954745](https://news.ycombinator.com/item?id=47954745) (caveman vs "be brief")
- [49080605](https://news.ycombinator.com/item?id=49080605) (JetBrains caveman)

## Likely questions, with the facts to answer from

**"Offline replay can't see behaviour changes."**
- Correct, and the report says so every time.
- That is why codegraph and context-mode are shown only as ceilings.
- Replayed numbers assume the same cache pattern and the same turns.

**"Isn't this just ccusage?"**
- ccusage does accounting, and saver-audit uses its dedupe rules and matches its token totals.
- What saver-audit adds: the context split (what the tokens were), cache-aware pricing of *removed* tokens, and saver replays.

**"How accurate is o200k for Claude?"**
- It is not Claude's tokenizer, so it is calibrated against usage deltas in your own logs (Theil–Sen fit with an intercept).
- The report prints k, n and fit quality per model.
- Recorded usage stays the source of truth for totals.

**"Why API prices if I'm on a subscription?"**
- The logs don't say how you pay. The report labels every dollar as API-equivalent and says it is not the bill.

**"Does it send my data anywhere?"**
- No. There is no network call except `--update-prices`, and there is a test for it.
- The card holds numbers, model names and dates only.
- The replay cache stores hashes and counts, not text.
- Readers can check this by running it with networking disabled.

**"Why is headroom a lower estimate?"**
- headroom compresses *older* Read/Grep/Glob/Edit/Write outputs as they age.
- saver-audit replays each output as the newest message, so that part isn't captured.

**"Why isn't fast-jev-compaction here?"**
- It acts only at compaction, and its decisions need its hosted API.
- It keeps more context than the built-in summary, so any token number would be mostly assumption.

**"Sampling?"**
- By default, big replays run on a deterministic sample, labelled "sample N%".
- Sampling was checked against full replays and was off by up to 40% for caveman, so rtk and caveman are now replayed in full (caveman above 500 tokens, about 5% conservative). headroom's 300-output sample was within 3% over the month but off by 20–37% on single weeks, so the launch numbers use its full replay (tech-notes §8.9).

**"Is it biased against savers?"**
- Conservative choices are listed in STATUS.md:
  - rtk's git status/log filters are excluded (format mismatch);
  - headroom is a lower estimate;
  - ceilings assume nothing replaces the removed output.
- **Where a saver helps, the report says so.** On Codex, headroom's 10.4% is the largest measured cut.

**"Why these savers?"**
- They are the 2026 savers with the most stars (70k+ each, plus context-mode at 24k).
- Adapters are small, so others can be added.

## Posting checklist (from docs/05-distribution.md)

- [ ] **Account setup:**
  - Put an email in your HN profile.
  - Your username should not be the project name.
- [ ] **Before posting:**
  - The repo is public (done).
  - `npx saver-audit` works from npm (publish first).
- [ ] **Title and link:**
  - The title must be under 80 characters, start with "Show HN:", and use no capitals for emphasis, no gratuitous numbers, no "here's what…".
  - Link the repo, not a blog post.
- [ ] **When:** Sunday 2026-10-04, 12:00–14:00 UTC. Stay for 4–6 hours to answer comments.
- [ ] **First comment, by hand:**
  - backstory;
  - how it works (replayed vs modeled);
  - the dataset;
  - 2–3 numbers, including one where a saver *did* help;
  - what it can't measure;
  - the earlier threads.
- [ ] **Never:**
  - ask for votes;
  - delete and repost.

Title ideas from the research (all under 80 characters; rewrite freely):
- `Show HN: Saver-audit – replay your Claude Code/Codex logs to test token savers` (78)
- `Show HN: Saver-audit – offline replay of agent logs to check token-saver claims` (79)
