# Reddit briefs (for the founder to write from)

These are briefs, not posts. Several target subs ban or penalise LLM-written text:
- r/LocalLLaMA: "Completely/primarily LLM generated copy… not allowed";
- r/opensource: "AI-generated content is low-effort and ban worthy";
- Reddit's spam filter removed earlier token-saver promo posts.

Write each post yourself, and don't copy text between subs. The facts are in [show-hn-fact-sheet.md](show-hn-fact-sheet.md); rules and evidence are in [05-distribution.md §1](../05-distribution.md). `⟦HEADROOM⟧` waits for the full replay.

## Shared shape (05-distribution §1.6)

1. **TL;DR**, 3 lines.
2. **Method:** 30 days, 54 sessions, Claude Code + Codex, offline, cache-aware pricing, and the three method labels.
3. **Results table.**
4. **"What this can't tell you":** behaviour changes, extra turns, answer quality. This answers the top comment on [1u9anzk](https://www.reddit.com/r/LocalLLaMA/comments/1u9anzk/) before anyone raises it.
5. **Credit** 1u9anzk, JetBrains and Quesma.
6. **Disclosure:** "I built this; MIT, free, offline."
7. **At the end:** the repo link and `npx saver-audit`.

Avoid:
- "cut X%" headlines, which Reddit's filter has removed before;
- link-only posts;
- identical text in two subs.

## D1 Mon 2026-10-05: r/ClaudeCode (422k)

- **Rule:** standalone "Built with Claude Code" posts must be detailed. Say what you built, how Claude Code was used, and what you learned. Otherwise it belongs in the weekly showcase thread.
- **Flair:** Built with Claude.
- **Angle:** "where my Claude Code tokens actually went". The personal audit comes first, savers second. Data posts do best here: "i did audit of 926 sessions" got 557 points.
- **Lead numbers (Claude Code only; 34 sessions, 801 subagent runs, 34,872 calls):**
  - $4,084 API-equivalent in 30 days, not a bill;
  - cache reads 55%, cache writes 33%;
  - 26% earlier turns re-read;
  - 16% system prompt and tool definitions;
  - 16% shell output.
- **Saver numbers (Claude Code only):**
  - rtk $41.88 (1.0%);
  - caveman engine $13.45 (0.3%);
  - caveman skill $94.71 (2.3%, modeled);
  - headroom ⟦HEADROOM⟧;
  - ceilings: codegraph ≤ $560 (13.7%), context-mode ≤ $655 (16.0%).
- **The "what I learned" part:**
  - the dedupe bug the ccusage cross-check caught;
  - that o200k needed about 1.5× calibration for Claude 4.7+;
  - that cache reads are 55% of the cost, and writes another 33%.
- **Image:** optional. Long text with a table has worked here.

## D2 Tue 2026-10-06: r/codex (209k)

- **Rule:** high-information posts get priority, and the low-karma queue doesn't apply to high-effort ones. Use the right flair.
- **Flair:** Comparison, or Showcase.
- **Angle:** Codex-specific.
  - Shell output is 44% of the Codex cost.
  - rtk would cut 4.2%, the largest measured cut in the whole run.
  - Codex hooks can't rewrite tool input, so the caveman and context-mode numbers are hypothetical.
  - Cached tokens are a subset of input on Codex, unlike Claude.
  - Say what that means for forked threads (the double-count bug).
- **Lead numbers:**
  - 20 sessions, 792 calls, $125, split into gpt-5.6-sol $68.70 and gpt-6-astra $56.26;
  - cache reads 63%;
  - rtk $5.20 (4.2%);
  - caveman engine $0.61;
  - codegraph ≤ $19.51;
  - context-mode ≤ $48.40.
- **Image:** the share card, or a Codex-only card. Image posts did well here: "I benchmarked every single usage saving tool" got 171 points. A Codex-only card comes from `--source codex --card`.

## D4 Thu 2026-10-08: r/ClaudeAI (1.15M), only if your account has over 100 karma

- **Rules:**
  - showcase: built by you, explain how Claude helped, free to try (say so), minimal promotional language;
  - comparative benchmarks need a source.
- **Flair:** Built with Claude, or Comparison.
- **Angle:** the method and honesty. Cite a source for every comparative number: the JetBrains −8.5% for the caveman skill, and for the saver versions, their repos.

## D6 Sat 2026-10-10: r/LLMDevs (flair Tools) or r/LocalLLaMA (flair Resources)

- **r/LLMDevs:** FOSS disclosure is required. It is MIT, and the free version is the only version.
- **r/LocalLLaMA:**
  - Disclose affiliation (1/10 rule). No LLM-written copy.
  - Lead with how this differs from 1u9anzk: one command on anyone's logs, Codex included, cache-aware dollars, labelled methods.
  - Link 1u9anzk and compare honestly. Their per-saver numbers were headroom 2.8%, rtk 0.5%, caveman 0.4%.

## D7 Sun 2026-10-11: "Showcase Sunday" subs

- **r/agenticAI and r/aipromptprogramming:** Sunday only, with the Showcase Sunday flair.
- **r/aipromptprogramming:** 4 paragraphs or fewer, and you must also contribute during the week.

## Before any of this

- **Build comment history** in these subs through genuine comments. r/ClaudeAI needs over 100 karma, and r/codex queues low-karma posts. Never trade votes.
- **Answer every comment on the same day.**
