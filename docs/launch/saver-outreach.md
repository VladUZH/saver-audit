# Saver outreach: getting more savers measured before launch

**Goal:** before the Show HN (planned Sunday 2026-10-04), get 3–5 more savers into saver-audit, ideally added by their own maintainers. Every saver added:
- makes the report and card more useful;
- gives its maintainer a reason to tell their users to "run `npx saver-audit` and see what X saves on your logs".

**This is a human step (GATE).** Opening issues or emailing maintainers is posting in public, so the founder sends every message. Claude prepares the targets and drafts.

## What we ask, and what they get

**The ask:** one of these, depending on the saver:
- **Replayable today:** review or merge a one-file manifest PR, or add it themselves (CONTRIBUTING.md).
- **Replayable with a small change:** add a stdin mode, i.e. one command that filters a tool output from stdin to stdout offline. Then add the manifest.
- **Upper bound:** confirm the ceiling rule describes their tool fairly.

**What they get:**
- a neutral, reproducible measurement on each user's own logs, labelled `replayed`;
- their row on every report and share card;
- a spot in the README;
- credit in the launch post.

**What we don't do:**
- bundle their code;
- download it for users;
- publish a number about their tool without offering them a chance to check the method first.

## Etiquette

- **One message per project,** through the channel they prefer: Discussions if enabled, otherwise an issue.
- **Open with the benefit to their users**, not with our launch.
- **Be clear this is your tool** ("I built saver-audit").
- **Include their own numbers** from your logs, with the method label and the caveat. Where they help, say so plainly.
- **Keep the numbers private until they reply:** if you share them, offer to hold public numbers for their tool until they've had a look.
- **Don't @-mention them in launch posts** without their OK.
- **Edit the drafts in your own voice.** GitHub has no AI-text rule, but maintainers notice form letters.

## Templates (edit before sending)

### A. Replayable today (e.g. rtk, the caveman engine)

> **Title:** saver-audit measures `<tool>` on users' own Claude Code/Codex logs, method check?
>
> Hi! I built saver-audit (`npx saver-audit`, MIT). It reads a developer's local Claude Code and Codex logs and shows where their tokens went. It also replays the recorded tool outputs through popular savers on the user's own installed copy, offline, and prices the result with prompt-cache costs.
>
> `<tool>` is one of them. It runs `<exact command>` on each output that `<routes>`. On my last 30 days it cut `<$ / %>` of `<$total>` API-equivalent spend, labelled "replayed".
>
> Could you check that the manifest describes `<tool>` fairly? `<link to manifest>`. Happy to change routes, versions or wording. I'd also welcome a PR from you if you'd rather own it.

### B. Replayable with a small change (e.g. lowfat)

> **Title:** a stdin mode would let saver-audit measure `<tool>` on users' logs
>
> Hi! I built saver-audit (`npx saver-audit`, MIT). It replays developers' own Claude Code and Codex logs through token savers, offline, and shows each user what each saver would have cut, next to their total spend.
>
> `<tool>` can't be replayed yet, because `<reason: filters only run live>`. One command that runs `<tool>`'s built-in filter for a given command on stdin would be enough, e.g. `<proposed: tool filter --for "git diff" < output.txt>`. Then a small JSON manifest (CONTRIBUTING.md) would put `<tool>` on every user's report and share card.
>
> Would you be open to that? I'm happy to send the manifest once it exists.

### C. Upper bound (behaviour-changing tools, e.g. codegraph, context-mode)

> **Title:** how saver-audit bounds `<tool>`'s savings, fair?
>
> Hi! I built saver-audit (`npx saver-audit`). Because `<tool>` changes which tools the agent uses, offline replay can't measure it. So the report shows only a best-case ceiling: `<rule, e.g. every exploration output disappears and nothing replaces it>`. On my logs that's ≤ `<%>`, labelled "ceiling", with a note that it isn't a measurement.
>
> Is that rule fair to `<tool>`? If you have a better way to bound it, or a published A/B I should cite next to it, I'd like to use it.

## Targets (researched 2026-09-25; stars from `gh api`)

Stdin modes were verified by reading each project's README and source, not by running the program. Anything marked "unverified" needs a real run before we publish a number.

### Tier 1: replayable today. Add a manifest, verify it, then send template A

| Saver | ★ | Licence | Replay command (from source) | Channel | Note |
|---|---|---|---|---|---|
| [ppgranger/token-saver](https://github.com/ppgranger/token-saver) | 152 | Apache-2.0 | `token-saver compress '<cmd>'` reads stdin, never executes (README l.507) → route args `["compress", "{command}"]` | Issues, Discussions | Unverified whether its `gh` processor calls the network; check before listing |
| [yvgude/lean-ctx](https://github.com/yvgude/lean-ctx) | 3.8k | Apache-2.0 | `lean-ctx compress diff - --shell "<cmd>" --json` (rust/src/cli/compress_cmd.rs) returns JSON, not the text | Discussions | Ask for a flag that prints only the compressed text; until then it needs a small JSON-aware adapter |
| rtk, caveman engine | 81.7k / 107.8k | Apache-2.0 / BSL-1.1 | already in | Issues | No ask; announce the integration and invite a method check (template A) |

### Tier 2: a small change makes them replayable (template B)

| Saver | ★ | The ask | Channel |
|---|---|---|---|
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | 73.8k | `headroom compress --stdin`: a plain CLI instead of our Python sidecar (faster, simpler, their users can run it too). Note: v0.39.0 is out; we pin 0.38.0 | Issues, Discussions |
| [zdk/lowfat](https://github.com/zdk/lowfat) | 575 | `lowfat filter --builtin <plugin> --sub=<sub>` to run a built-in filter on stdin (built-ins are `.lf` files compiled into the binary) | Issues |
| [edouard-claude/snip](https://github.com/edouard-claude/snip) | 451 | `snip filter <name> < file`; today every command runs the program | Issues, Discussions |
| [alexgreensh/token-optimizer](https://github.com/alexgreensh/token-optimizer) | 2.4k | A side-effect-free `compress --stdin` (its hook script also writes archives). Licence PolyForm Noncommercial: only call the user's install | Issues |

### Tier 3: special cases

- **[teamchong/pxpipe](https://github.com/teamchong/pxpipe)** (7.4k, MIT): `pxpipe export --stdin` works offline, but it turns text into images. Image tokens follow a pixel formula, not text tokens, and the conversion is lossy. Needs its own adapter and an accuracy caveat, so ask them to confirm the image-token formula first.
- **Upper bounds with big audiences (template C).** These are the same class as codegraph and could be added as ceiling manifests if their maintainers agree the rule is fair:
  - [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) (44.9k)
  - [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) (31.8k)
  - [trailhq/Graft](https://github.com/trailhq/Graft) (9.2k)
  - [MinishLab/semble](https://github.com/MinishLab/semble) (6.1k)
- **Not measurable offline:**
  - fast-jev-compaction (hosted API);
  - paritok (LLM gateway);
  - mcp2cli and toolport (tool schemas aren't in the logs).
- **Output-style prompts** (claude-token-efficient, Chisle, ponytail): modeled only, which needs a published measurement.

### Suggested order

1. **Now:** add and verify manifests for token-saver and lean-ctx. Claude can install them into `~/.saver-audit/tools` and test them on real logs. Then send template A to both.
2. **This week:** template B to headroom and lowfat (highest reach, smallest ask), then snip and token-optimizer.
3. **Before launch:** template C to codebase-memory-mcp and code-review-graph. Their audiences are large, and a fair ceiling rule they endorse is launch material.
4. **pxpipe:** after launch, once the image-token formula is confirmed.
