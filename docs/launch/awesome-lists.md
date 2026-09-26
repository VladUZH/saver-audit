# Awesome lists: where saver-audit fits, and when

Researched 2026-09-26: rules read from each list's README, CONTRIBUTING and templates. Every submission is public and under the founder's account (GATE).

Lists marked **HUMAN** must be submitted by you, by hand; they reject or ban agent-made submissions.

When submitting:
- **Vary the wording per list.** Quesma reviews near-identical submissions sent to many lists more closely.
- **No marketing words,** and don't address the reader.

## Submitted or prepared (2026-09-26)

| List | Stars | How | Status |
|---|---|---|---|
| [bradAGI/awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents) | 1.3k | PR | prepared for review |
| [ai-for-developers/awesome-ai-coding-tools](https://github.com/ai-for-developers/awesome-ai-coding-tools) | 2.1k | PR | prepared for review |
| [eltociear/awesome-AI-driven-development](https://github.com/eltociear/awesome-AI-driven-development) | 548 | PR | prepared for review |
| [RoggeOhta/awesome-codex-cli](https://github.com/RoggeOhta/awesome-codex-cli) | 533 | issue (PRs are not processed) | prepared for review |
| [InftyAI/Awesome-LLMOps](https://github.com/InftyAI/Awesome-LLMOps) | 264 | "Project Request" issue form (a bot opens the PR) | prepared for review |

## Later

### 2026-10-09 or later: hesreallyhim/awesome-claude-code (54.6k) **HUMAN**
- **Rules:**
  - the repo must be at least 14 days old, with commits after the first day, or have 100+ stars; otherwise it is closed automatically;
  - submit through the web issue form only (`?template=recommend-resource.yml`): no PR, no gh CLI;
  - a trap checkbox in the form must stay **unchecked**;
  - the maintainer's advice: "Build something awesome; Get users; then submit."
- **Category:** Observability & Monitoring > Usage & Cost (ccusage, goccc and toktrack are there).
- **Form values:**
  - Display name: `saver-audit`
  - Author: `VladUZH`, https://github.com/VladUZH
  - Description (10–500 characters, descriptive, no "you"): *Offline CLI (`npx saver-audit`) that reads local Claude Code and Codex session logs, prices token use including prompt-cache reads and writes, and replays recorded tool output through installed token savers (rtk, headroom, lean-ctx, caveman) to estimate what each would cut. Each result is labelled replayed, modeled or upper bound.*

### After launch, with an outside adoption signal: QuesmaOrg/awesome-ai-tokenomics (188, the best topical fit)
- **Rules:**
  - it needs at least one independent adoption signal: an HN thread, a third-party mention, or npm downloads beyond your own. Stars alone don't count, and they check where stars come from;
  - they review the submitting account's PR history;
  - every claim needs a public source and a `verified_on` date.
- **What a PR touches:** `README.md`, `research/<area>.md` and `research/manifest.json`; then run `scripts/lint_readme.sh`.
- **Section:** Understand > Compression Efficacy (next to the JetBrains rtk/Caveman benchmark).
- **Entry:** `- [saver-audit](https://github.com/VladUZH/saver-audit) - An open-source CLI that replays a developer's own Claude Code and Codex session logs through token savers (rtk, headroom, lean-ctx, caveman), priced with prompt-cache rates, and labels each result replayed, modeled or upper bound.` plus the kind and last-commit badges.

### After launch, with real downloads: milisp/awesome-codex-cli (116)
- **Rules:** "Projects must show proven external usage." The PR template has a "Proof of Traction" section; npm weekly downloads work.
- **Section:** Tools > Stat.
- **Entry:** `- [saver-audit](https://github.com/VladUZH/saver-audit) - Offline CLI that reads Codex CLI and Claude Code session logs, prices token use with prompt-cache costs, and replays sessions through token savers to estimate what each would cut.`

### 2026-10-25 or later, and only with >50 stars (or a 2nd contributor): pleasedodisturb/awesome-llm-token-optimization (81)
- **Rules:** CI enforces repo age ≥ 30 days, a recent commit, and either ≥ 2 contributors or > 50 stars. Disclose self-submission in the template. One entry per PR.
- **Section:** Cost Tracking Tools (ccusage, agenttrace).
- **Entry:** `- [saver-audit](https://github.com/VladUZH/saver-audit) - Offline CLI that prices Claude Code and Codex session logs with prompt-cache costs and replays them through token savers (rtk, Headroom, lean-ctx, caveman) to measure what each would cut. ![Stars](https://img.shields.io/github/stars/VladUZH/saver-audit)`

### 2026-12-25 or later, and >20 stars: agarrharr/awesome-cli-apps (20.5k) **HUMAN**
- **Rules:**
  - "AI-generated PRs are not welcome": write the PR yourself and say why you think the app is awesome;
  - its AGENTS.md plants a marker instruction for agents, so it is a detection trap;
  - PR title `Add saver-audit`, one PR per app;
  - don't use the words "CLI" or "terminal".
- **Section:** AI > Agents (lean-ctx and toktrack are there).
- **Format:** `[APP_NAME](LINK) - DESCRIPTION.`

### Optional, low odds
- [jamesmurdza/awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools) (3.9k):
  - last merge in June and 275 open PRs;
  - a bot checks for `## Description` and `## Checklist`;
  - one checklist item says "uses AI", and saver-audit doesn't call a model, so say so honestly;
  - section: Usage Analytics & Cost Tracking.
- [tensorchord/Awesome-LLMOps](https://github.com/tensorchord/Awesome-LLMOps) (5.9k): merges come in bursts, the last in May. Table row under Optimizations.

## Skipped
- jqueryscript/awesome-claude-code: the maintainer adds entries himself, and none of the last 30 PRs was merged.
- ContextJet-ai/awesome-llm-observability: 250-star minimum.
- Meirtz/Awesome-Context-Engineering, ai-boost/awesome-harness-engineering, rohitg00/awesome-claude-code-toolkit, LangGPT/awesome-claude-code: stale, or they don't merge.
- davepoon/buildwithclaude: plugins only.
