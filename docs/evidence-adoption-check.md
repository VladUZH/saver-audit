# Check D: adoption signals for ideas 19, 17, 39, 86

Date: 2026-09-25. The question here is adoption: can this become extremely popular with people building with AI, even while it is free? Willingness to pay is not judged.

## How the numbers were gathered

- **GitHub:** `gh api repos/OWNER/REPO` (stars, creation date, last push) and `gh search repos`, all read on 2026-09-25.
- **Dated star growth was not available.** On 2026-09-25 the stargazer-timestamp endpoint (`repos/…/stargazers` with `application/vnd.github.star+json`) returned HTTP 404 for every repo tried, and the GraphQL `stargazers` connection returned no edges. As substitutes, this note uses (1) the average stars per day since the repo was created, and (2) the change since the counts recorded in the tournament notes (file dated 2026-09-23; the exact capture time is unknown, roughly 2 days ago).
- **npm:** `api.npmjs.org/downloads/point/last-month` for 2026-08-23 to 2026-09-21. **PyPI:** pypistats.org, recent month. **HN:** the Algolia API. **Hugging Face:** the public HF API.
- **Anything marked "estimate"** is my own arithmetic from the stated assumptions, not a measurement.

---

## 1. Idea 19: Agent token-waste control

### (a) Closest free and open-source projects

| Project | Stars (09-25) | Created | Avg ★/day | Other signal |
|---|---|---|---|---|
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | 107,788 | 2026-04-04 | 619 | +394 since the 09-23 notes. HN test post 46 pts ([link](https://news.ycombinator.com/item?id=49080605)). Its savings claims are disputed |
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | 81,689 | 2026-01-22 | 332 | +234 since the 09-23 notes. Quesma's counter-benchmark drew 170 pts / 84 comments ([HN](https://news.ycombinator.com/item?id=49656471)) |
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | 73,774 | 2026-01-07 | 283 | PyPI `headroom-ai` 246,971 downloads/month; npm `headroom-ai` 98,113/month |
| [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) | 72,064 | 2026-01-18 | 288 | Pre-indexed code graph for agents, pitched as a token saver |
| [mksglu/context-mode](https://github.com/mksglu/context-mode) | 24,051 | 2026-02-23 | 112 | npm 69,124/month. Show HN 84 pts ([link](https://news.ycombinator.com/item?id=47148025)) |
| [ccusage/ccusage](https://github.com/ccusage/ccusage) | 18,735 | 2025-05-29 | 39 | npm 341,336/month |
| [steipete/CodexBar](https://github.com/steipete/CodexBar) (Swift, macOS) | 21,899 | 2025-11-16 | 70 | Menu-bar usage meter |
| [getagentseal/codeburn](https://github.com/getagentseal/codeburn) | 11,229 | 2026-04-13 | — | npm 40,332/month. Show HN 112 pts ([link](https://news.ycombinator.com/item?id=47759035)) |
| [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale) | 5,536 | 2025-12-01 | — | npm 102,595/month |
| [vinzdg/codenotch](https://github.com/vinzdg/codenotch) (Swift, macOS) | 2,479 | 2026-09-05 | 124 | 20 days old |
| [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) | 6,782 | 2026-09-17 | 848 | Riding the Jev launch wave: 6.8k stars in 8 days |
| [knowsuchagency/mcp2cli](https://github.com/knowsuchagency/mcp2cli) | 2,404 | 2026-03-09 | — | Tool-list slimming |
| [btsouth/toolport](https://github.com/btsouth/toolport) | 221 | 2026-06-19 | — | Lazy MCP gateway |
| [weave-os/router](https://github.com/weave-os/router) | 5,168 | 2026-04-27 | 34 | +338 since the 09-23 notes. Funded ($13.5M reported in the earlier notes) |

**Pattern.** Token saving is the most reliably viral agent-tooling category of 2026. At least four repos created this year passed 70k stars, and new entrants still break out: fast-jev-compaction got 6.8k stars in a week. The claims are contested, though: Quesma measured rtk at about 5% cheaper on Claude/Fable and about 5% more expensive on DeepSeek ([HN](https://news.ycombinator.com/item?id=49656471)). Stars follow the story, not measured savings. HN is a minor channel here: the big repos spread through GitHub Trending and X, and their own HN posts scored under 20 points.

### (b) Communities that would spread it

- **Claude Code users:** `@anthropic-ai/claude-code` has 58,966,736 npm downloads a month.
- **Codex users:** `@openai/codex` has 79,224,189 npm downloads a month. Both download counts include CI installs.
- **Spread channels:** GitHub Trending, X, dev.to and daily.dev. The Spotify story about cutting Claude Code token usage by 90% got 278 pts / 178 comments ([HN](https://news.ycombinator.com/item?id=49571465), [Spotify Engineering](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)), which shows that "cut my tokens" headlines travel.

### (c) Cost to serve free users (estimate)

**Assumptions:** a local CLI or plugin, distributed through GitHub Releases, Homebrew and npm, with no hosted component.

- **10k users:** about $0/month. **100k users:** about $0/month. Distribution is free.
- **Optional neutral benchmark matrix:** this is a fixed cost that does not depend on user count. Quesma's figures imply about $1.6–1.7 per agent attempt on Claude/Fable (see the HN item above). One refresh of 5 savers × 2 harnesses × 2 models × 30 tasks × 3 repeats is 1,800 attempts, or about $3k. That is an estimate.
- **Avoid a hosted proxy.** Sitting in the path of users' API keys adds cost and destroys trust.

### (d) Platform moves

- **Anthropic** already absorbs the easy wins:
  - [tool search / deferred MCP tool loading](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool);
  - the `/context`, `/compact`, `/autocompact`, `/rewind` and `/mcp` toggles plus automatic prompt caching, promoted in the official guide ["Maximizing the value of your Claude Code sessions"](https://claude.com/blog/maximizing-the-value-of-your-claude-code-sessions) (2026-08-14).
- **Spotify** published its own hook-based bulk-read router (Portal / AiKA, 2026-09).
- **Nobody** has shipped a neutral way to answer "did this saver actually help on *my* sessions?" Quesma measured one saver once, and its product is listed as "early access" in the earlier notes.

### (e) Weekend version

**`npx saver-audit`:** a zero-API-call replay of the user's own local Claude Code / Codex JSONL transcripts.

- It applies rtk's, caveman's and context-mode's published filters and rules offline to the recorded tool outputs and prompts.
- It counts tokens before and after with the model's tokenizer, and reports what each saver *would have* saved on that user's real sessions.
- It is honest about what cannot be replayed: cache effects, and behaviour changes that cause extra turns.

**Launch post:** "RTK says 60–90%. Caveman says 65%. Run one command to see what they would have saved on *your* last 200 sessions. Local, no API calls." Every number in the post must come from the author's own run.

This rides the two biggest repos in the category and the live dispute. A Swift menu-bar "waste meter" is a possible second step, but that space already has CodexBar (21.9k) and codenotch (2.5k in 20 days).

### (f) Verdict

**Adoption evidence: STRONG.** A newcomer can still win: new 5k–100k-star entrants keep appearing, and fast-jev-compaction got 6.8k stars in 8 days.

**The biggest reason:** demand is proven and fashion-driven, so a newcomer with a sharp hook gets attention. But the durable part is fragile. Anthropic keeps shipping the savings natively, and a neutral auditor gets attention mostly when a saver's claims are in dispute. Expect a spike, not a moat.

---

## 2. Idea 17: Post-cutoff knowledge packs and fix commons

### (a) Closest free and open-source projects

| Project | Adoption |
|---|---|
| [upstash/context7](https://github.com/upstash/context7) | 62,414★ (created 2025-03-26). `@upstash/context7-mcp` has 3,451,044 npm downloads a month and `ctx7` 139,113. Only +74★ since the 09-23 notes, so growth has flattened to a mature pace |
| [anthropics/skills](https://github.com/anthropics/skills) | 178,071★ |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills`) | 32,444★. The npm `skills` package has 28,522,027 downloads a month |
| [openai/skills](https://github.com/openai/skills) | 27,619★ |
| [TanStack/intent](https://github.com/TanStack/intent) | 332★, but `@tanstack/intent` has 553,908 npm downloads a month. Version-matched skills ship inside packages |
| [idosal/git-mcp](https://github.com/idosal/git-mcp) | 8,423★. Show HN 185 pts ([link](https://news.ycombinator.com/item?id=43573539)). Last push 2026-05-08 |
| [anomalyco/models.dev](https://github.com/anomalyco/models.dev) | 6,997★. Already publishes a `knowledge` (cutoff) field per model ([api.json](https://models.dev/api.json)), e.g. claude-opus-5-5 → 2026-06 |
| [arabold/docs-mcp-server](https://github.com/arabold/docs-mcp-server) | 1,757★; npm 6,997 a month |
| [MicrosoftDocs/mcp](https://github.com/MicrosoftDocs/mcp) | 1,908★ |
| [ref-tools/ref-tools-mcp](https://github.com/ref-tools/ref-tools-mcp) | 1,175★ |
| [mozilla-ai/cq](https://github.com/mozilla-ai/cq) (fix commons) | 1,278★. Only +3 since the 09-23 notes and about 6★/day lifetime, despite a 225-pt Show HN ([link](https://news.ycombinator.com/item?id=47491466)) |
| Stack Overflow for Agents | Beta since 2026-06-10. Best HN post 18 pts ([link](https://news.ycombinator.com/item?id=48480515)). Usage not disclosed |
| [HaoooWang/llm-knowledge-cutoff-dates](https://github.com/HaoooWang/llm-knowledge-cutoff-dates) | 499★ |
| Academic freshness benchmarks | [GitChameleon 2.0](https://arxiv.org/html/2507.12367v2), [LibEvoBench](https://arxiv.org/html/2606.25402v1). No product or leaderboard traction found |

**Pattern.** The "fresh docs" half is a proven mass category, but it is owned by Context7 and by vendors. The "fix commons" half shows weak pull after launch: cq is flat, and Stack Overflow for Agents gets low HN engagement.

### (b) Communities

It reaches the same mass audience as idea 19: every Claude Code, Codex and Cursor user. Library maintainers are a second channel, and TanStack Intent shows that maintainers will ship skills themselves.

### (c) Cost to serve free users (estimate)

**Static delta packs** (generated files shipped through npm or GitHub, no LLM at query time) cost about $0 at 10k or 100k users.

**A hosted MCP retrieval endpoint without an LLM in the loop:**
- Assumptions: Cloudflare Workers + R2, 300 calls per user per month.
- 100k users = 30M requests ≈ $5 base + (20M × $0.30/M) ≈ **$11/month**. 10k users ≈ **$5/month**.

**An LLM in the loop is much more expensive.** Context7 cut its free tier from about 6,000 to 500 calls a month on 2026-01-13, citing LLM costs, then raised it to 1,000 ([founder post](https://x.com/enesakar/status/2011896241047978236), [plans](https://context7.com/plans)). Avoid that design.

**The per-model "cutoff quiz" is a fixed cost.** 200 libraries × 20 probes × 10 models = 40k calls. At about 2k tokens each that is roughly $100–$1,000 per refresh, depending on the model mix (estimate).

### (d) Platform moves (all shipped)

- **OpenAI:** [Docs MCP](https://developers.openai.com/learn/docs-mcp).
- **Anthropic:** a `claude-api` skill and the public skills repo.
- **Microsoft:** the Learn MCP server, built into Visual Studio.
- **Google:** a Developer Knowledge API MCP ([Google Cloud blog](https://cloud.google.com/blog/products/ai-machine-learning/google-managed-mcp-servers-are-available-for-everyone)).
- **AWS:** its MCP server went GA on 2026-05-06 with documentation search ([AWS blog](https://aws.amazon.com/blogs/aws/the-aws-mcp-server-is-now-generally-available/)).
- **Vercel:** the agents-md codemod, plus `npx skills`.
- **Stack Overflow:** Stack Overflow for Agents.

### (e) Weekend version

**`npx stale-deps`.** No LLM and no server. It:
1. reads package.json, pyproject or Package.resolved;
2. takes the agent's model cutoff from models.dev;
3. pulls publish dates from the npm or PyPI registries;
4. lists every dependency that shipped a major or breaking release after that cutoff, with links to its changelog or migration guide;
5. writes a short "post-cutoff changes" block into AGENTS.md or CLAUDE.md.

**Launch post:** "Your agent's knowledge ends in <month>. N of your dependencies shipped breaking releases since. One command lists them and tells your agent." Use real numbers from a real repo.

### (f) Verdict

**Adoption evidence for the category: STRONG. For a newcomer: WEAK.**

**The biggest reason:** distribution is already locked up. Context7 alone has 3.45M npm downloads a month and 62k stars, lab and vendor docs MCPs and skills ship free by default, and the one uncovered piece, the fix commons, showed weak pull even with Mozilla behind it.

The weekend `stale-deps` wedge could get a respectable launch, but it is a feature that Context7 or models.dev could add in a day.

---

## 3. Idea 39: Decision nodes for Godot, Home Assistant and ROS

### (a) Closest free and open-source projects

**Engine-side integrations stay small.** The best in each ecosystem stall at about 1.5k stars:

| Project | Stars | Created | Notes |
|---|---|---|---|
| [nobodywho-ooo/nobodywho](https://github.com/nobodywho-ooo/nobodywho) | 1,391 | 2024-09 | The leading Godot local-LLM plugin ([Asset Library](https://godotengine.org/asset-library/asset/2886)). About 2★/day. HN posts 2 pts |
| [FlamxGames/godot-ai-assistant-hub](https://github.com/FlamxGames/godot-ai-assistant-hub) | 308 | | |
| [Adriankhl/godot-llm](https://github.com/Adriankhl/godot-llm) | 254 | | Last push 2024-06 |
| [elefant-ai/player2-ai-npc-godot](https://github.com/elefant-ai/player2-ai-npc-godot) | 31 | | |
| [homeassistant-ai/ha-mcp](https://github.com/homeassistant-ai/ha-mcp) | 4,840 | | Unofficial HA MCP server |
| [acon96/home-llm](https://github.com/acon96/home-llm) | 1,442 | | |
| [jekalmin/extended_openai_conversation](https://github.com/jekalmin/extended_openai_conversation) | 1,441 | | |
| [ITSpecialist111/ai_automation_suggester](https://github.com/ITSpecialist111/ai_automation_suggester) | 788 | | |
| [nasa-jpl/rosa](https://github.com/nasa-jpl/rosa) | 1,640 | | ROS |
| [robotmcp/ros-mcp-server](https://github.com/robotmcp/ros-mcp-server) | 1,473 | | ROS. Show HN 26 pts |
| [mgonzs13/llama_ros](https://github.com/mgonzs13/llama_ros) | 264 | | ROS |
| [BehaviorTree/BehaviorTree.CPP](https://github.com/BehaviorTree/BehaviorTree.CPP) | 4,218 | | The host framework itself |

**The decision-model layer is saturated, and it moved fast.** All of these appeared in the week after Jev launched:

| Project | Stars | Created | Notes |
|---|---|---|---|
| [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) | 23,933 | 2026-09-18 | Apache-2.0; 33 ms per question on a T4 |
| [jaredpalmer/kev](https://github.com/jaredpalmer/kev) | 6,871 | | Includes a chess demo |
| [TheoLeeCJ/SemIf-OpenJev](https://github.com/TheoLeeCJ/SemIf-OpenJev) | 4,280 | | "semantic ifs" on a 3090, with MLX and llama.cpp backends |
| [wfzyx/von](https://github.com/wfzyx/von) | 660 | | Plays ViZDoom from a game loop, about 18 ms |

**Game and robot demos draw hundreds of stars, not thousands:** [fhshaik/typesafe-mario](https://github.com/fhshaik/typesafe-mario) has 392 and [RomanSlack/jev-drone](https://github.com/RomanSlack/jev-drone) has 189. No repo yet packages typed decisions as a Godot node, a Home Assistant service or a BehaviorTree node. The only hits are [jev-home-assistant-sentinel](https://github.com/bojansandhaus/jev-home-assistant-sentinel) (1★) and JevHomeAssistant (0★).

**What does spread in these communities** is AI that *builds* for them, not AI that runs inside them. "Claude Code skills that build complete Godot games" got 337 pts ([HN](https://news.ycombinator.com/item?id=47400868)). On the runtime side, the one big HN hit is 2024's "fully local LLM voice assistant for my smart home" at 699 pts ([HN](https://news.ycombinator.com/item?id=38985152)).

### (b) Communities

| Community | Size |
|---|---|
| Home Assistant | 688,153 active installations ([analytics](https://analytics.home-assistant.io/); date not shown on the page); [home-assistant/core](https://github.com/home-assistant/core) 91,142★ |
| Godot | [godotengine/godot](https://github.com/godotengine/godot) 117,752★; r/godot about 374k members (per [GummySearch](https://gummysearch.com/r/godot/); may be stale) |
| ROS 2 | [ros2/ros2](https://github.com/ros2/ros2) 6,086★ (community size otherwise unknown) |

The communities are large, but their LLM-runtime subsets are small, going by the star counts above. Parts of the gamedev community are hostile to generative AI. The GDC 2026 survey figure in the earlier notes was not re-verified here.

### (c) Cost to serve free users (estimate)

**Assumptions:** nodes distributed through the Godot Asset Library, HACS and ROS package index; models are open weights (for example Laya, Kev or Von under Apache-2.0) downloaded from Hugging Face; inference runs locally.

- **10k users:** about $0. **100k users:** about $0.
- **If it defaults to a hosted Jev API,** users bring their own key, so the founder's cost is still $0.
- **The only real cost is maintenance:** 3 engines × releases × platforms (GDExtension builds for Windows, macOS, Linux and Android).

### (d) Platform moves

- **Home Assistant** shipped this natively. Since 2025.8, `ai_task.generate_data` returns "a data structure of your choice", accepts camera attachments, and runs on local Ollama ([2025.8 release](https://www.home-assistant.io/blog/2025/08/06/release-20258/), [AI in HA](https://www.home-assistant.io/blog/2025/09/11/ai-in-home-assistant/)). What is not native: calibrated probabilities and millisecond latency.
- **NVIDIA** ships a free [Game Agent SDK](https://github.com/NVIDIA/game-agent-sdk) (23★, UE5 only).
- **Godot and ROS:** no official move found.

### (e) Weekend version

**A Godot GDExtension node called `Decide`**, with `choice()`, `yes_no()` and `score()` returning probabilities from a bundled small open decision model (GGUF via llama.cpp, or Von/Laya weights), batched per physics tick. The launch artifact is a 30-second clip of NPCs reacting to the player's free-text chat inside the game loop.

**Launch post:** "`if Decide.yes_no("Is the player threatening the guard?", state) > 0.8:` Typed semantic ifs inside Godot, fully offline, no API key." Quote only latency measured in the demo.

The Home Assistant variant is a HACS "semantic condition" that returns a probability in automations. It is weaker, because AI Task already covers most of it.

### (f) Verdict

**Adoption evidence: WEAK.** A newcomer can own the niche, since no typed-decision node exists yet in any of the three ecosystems. But the ceiling is low.

**The biggest reason:** in all three ecosystems, even the best local-LLM runtime plugins top out at about 1.4–1.6k stars after one to three years. Home Assistant has already made structured AI decisions a built-in feature. Viral potential is limited to a one-off demo clip.

---

## 4. Idea 86: Quant and derivative assay office

### (a) Closest free and open-source projects

**Standalone scoreboards show little engagement:**
- [LocalBench](https://localbench.substack.com/archive): 10 posts from 2026-04-07 to 04-26, with 0–17 likes and 0–3 comments per post, then nothing after April 26.
- [Intel low-bit leaderboard](https://huggingface.co/spaces/Intel/low_bit_open_llm_leaderboard): 228 likes, last modified 2026-07-09.
- The HN post "Gemma 4 31B GGUF quants ranked by KL divergence" got 1 pt ([link](https://news.ycombinator.com/item?id=47675338)).
- GitHub search for quant-quality benchmark tools finds nothing above 102★ ([local-llm-lab](https://github.com/duongngocbinh56599-ui/local-llm-lab) 102, [apple-silicon-llm-bench](https://github.com/john-rocky/apple-silicon-llm-bench) 70).
- [Quesma](https://quesma.com/blog/qwen38-27b-quantizations-benchmarked/) (2026-08-26) benchmarked 5 quants of Qwen3.8-27B for about $3,000 of Modal GPU time. Terminal-Bench alone was $2,308.
- [The Kaitchup](https://kaitchup.substack.com/archive) is still active, but it is a paid newsletter.

**The demand is real where people pick a model:**
- [AlexsJones/llmfit](https://github.com/AlexsJones/llmfit) ("which models run on my hardware") has 37,144★ since 2026-02-15, about 167★/day, and got 301 HN pts ([link](https://news.ycombinator.com/item?id=47211830)). It already scores every model on "quality", and HF built [hf-agents](https://github.com/huggingface/hf-agents) on top of it. Whether llmfit's quality score uses measured KLD is unknown; its README describes a scoring model, not per-file measurements.
- Download volumes for Qwen3.8-27B GGUFs, all created 2026-08-13/14 ([HF API](https://huggingface.co/api/models/unsloth/Qwen3.8-27B-GGUF)):
  - `unsloth/Qwen3.8-27B-GGUF`: 6,938,321 downloads, 4,600 likes;
  - `lmstudio-community/…`: 1,563,669;
  - `bartowski/…`: 488,319.
- Upload volume: the latest 1,000 GGUF repos on HF were created between 2026-09-21 14:49 and 2026-09-25 11:56, about 250 new GGUF repos a day.
- Publishers self-grade: Unsloth publishes its own KLD and top-1 figures ([docs](https://unsloth.ai/docs/basics/dynamic-3.0-ggufs)); [unslothai/unsloth](https://github.com/unslothai/unsloth) has 76,747★.
- PyPI: `gguf` has 5,474,765 downloads a month, `mlx-lm` 526,317 and `auto-round` 342,087.

### (b) Communities

- **r/LocalLLaMA:** about 832k members on 2026-09-23 per a search-result snippet ([GummySearch](https://gummysearch.com/r/LocalLLaMA/)); not independently verified.
- **Runtime users:** [ollama/ollama](https://github.com/ollama/ollama) 181,674★ and [llama.cpp](https://github.com/ggml-org/llama.cpp) 129,483★.
- **Also:** LM Studio users, MLX and Apple on-device developers, and the quantizers themselves (Unsloth, bartowski, mradermacher).

### (c) Cost to serve free users (estimate)

**The cost scales with the number of quants graded, not with users.** A static site plus SVG badges on Cloudflare Pages costs about $0 at 10k or at 100k users.

**KLD compute estimate.** Assumptions:
- `llama-perplexity --kl-divergence` over about 300k tokens;
- a 27B dense model on a rented H100 at about $2.5/hour;
- about 10 minutes per quant file including download and load;
- about $0.40 per file; large MoE files at $5–20 each;
- one BF16 baseline-logit pass per parent.

Grading the top 20 repos × 10 files for each of about 10 notable releases a month is about 2,000 files, or **about $1k–4k a month**. Adding task batteries (tool-call parse rate, agentic tasks) is 10–100× more per Quesma's $3k for 5 quants, so keep those to a small sample.

An Apple-silicon-only MLX track could run on the founder's own Macs at about $0 cash, but slowly.

### (d) Platform moves

**Hugging Face** launched [Community Evals](https://huggingface.co/blog/community-evals) in Feb 2026 ([InfoQ](https://www.infoq.com/news/2026/02/hugging-face-evals)):
- scores live in `.eval_results/*.yaml` in the model repo, show on the model card, and feed a benchmark-dataset leaderboard;
- each score is labelled author-submitted, community-submitted or verified;
- on 2026-06-30 [EEE interop](https://huggingface.co/blog/eee-community-evals) added "verified" checkmarks.

This is both the ready-made badge channel and the absorption risk: HF could register a KLD benchmark itself. The earlier notes also record NVIDIA acquiring HF ([NVIDIA blog](https://blogs.nvidia.com/blog/nvidia-to-acquire-hugging-face/); not re-verified here).

**Others:** Unsloth self-reports its numbers, and LM Studio curates its own lmstudio-community quants. No Ollama or LM Studio "quality badge" was found.

### (e) Weekend version

**"Which Qwen3.8-27B file should I download?"** Run KLD and top-1 agreement versus BF16 for the 30 most-downloaded GGUF files across Unsloth, bartowski, lmstudio-community and mradermacher. Publish:
- a sortable table by RAM budget;
- the raw logs;
- a registered HF benchmark dataset (the `eval.yaml`) so that results can appear on model cards through Community Evals.

Then make the measured numbers usable as a data feed that llmfit or LM Studio could adopt. Opening PRs to other people's repos is a later step for the founder, not part of this check.

**Launch post:** "We measured the 30 most-downloaded Qwen3.8-27B GGUFs against BF16. Here is the best file for 16, 24 and 32 GB, and the popular ones that are worse than their size suggests." Use only measured results.

### (f) Verdict

**Adoption evidence: MEDIUM for the need, WEAK for a standalone scoreboard.**

**The biggest reason:** people want the answer at the point where they choose a model, inside llmfit, LM Studio or the HF page, not on a separate leaderboard. Every standalone quant scoreboard so far (LocalBench, Intel, the HN KLD post) drew little engagement, while llmfit got 37k★.

A newcomer can win only as the measured-data layer that those tools and HF Community Evals display. That is a real but invisible role, and it is not a brand of its own.

---

## Ranking by adoption potential for a solo newcomer

1. **Idea 19, token-waste control.** Strong, fashion-driven demand. The neutral "what would it have saved on my sessions" audit is the open wedge. Expect a spike, not a moat.
2. **Idea 86, quant assay.** Medium. It works only as the data layer inside llmfit, LM Studio or HF Community Evals.
3. **Idea 17, post-cutoff packs.** The category is strong but locked by Context7 and the vendors. A newcomer's odds are weak.
4. **Idea 39, decision nodes.** Weak. The niche is open, but the ceiling is about 1.5k stars.
