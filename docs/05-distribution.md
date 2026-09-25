# 05: Distribution plan for `npx saver-audit`

**Checked:** 2026-09-25, unless a row says otherwise.
**Method:** read-only. I made no posts, comments, votes, stars, sign-ups, server joins or contact with anyone.
**Sources:**
- HN: the Algolia API.
- GitHub: `gh api` (read-only).
- Discord sizes: the public invite-metadata endpoint, which reports member counts without joining.
- Everything else: WebFetch/curl of the pages cited.

"Unverified" means I could not confirm it today. Point-in-time counts (points, members, stars) will drift.

**Limit on this research:** the session's shared web-search quota ran out partway through, and reddit.com blocks curl and WebFetch. Reddit data was read through public JSON endpoints in a browser that was not logged in (§1). The lists of Claude-Code-specific newsletters and Discord channels are probably incomplete. See §9.

---

## 0. The short version

### Where attention for this category comes from, going by the evidence

1. **X plus GitHub Trending.**
   - The four 70k+ star savers spread there. Their own HN posts were small: rtk's best was 18 points, headroom's 10, codegraph's 5 (§2.1).
   - The audience is huge: `@anthropic-ai/claude-code` has about 59M npm downloads a month and `@openai/codex` about 79M (`evidence-adoption-check.md`).
2. **Hacker News, for *measurement* stories.** The skeptical or measured angle is exactly what does well on HN:
   - Quesma's rtk counter-benchmark: 170 points.
   - "The Token Compression Illusion": 121.
   - "I benchmarked caveman against 'be brief'": 89.
   - Session-analytics Show HNs: Rudel 144, CodeBurn 112.
   - saver-audit fits this pattern.
3. **Reddit: r/ClaudeCode (422k), r/ClaudeAI (1.15M), r/codex (209k).**
   - Long, data-heavy text posts do well there: "i did audit of 926 sessions" got 557 points, and a JetBrains saver-benchmark repost got 264 (§1).
4. **Newsletters that already covered the category:**
   - TLDR Dev ran caveman's 65% claim on 2026-04-06.
   - Simon Willison and AINews both covered ccusage, which is also an `npx` tool that reads local logs.
   - A measured follow-up is a natural story for all three.
5. **Awesome lists and directories.** These give a slow, steady tail. The main one only accepts entries 14 days after the first commit or at 100 stars (§6).

### Fix these before launch

- **The premise has already been posted, and "the claims are wrong" is old news.**
  - r/LocalLLaMA [1u9anzk](https://www.reddit.com/r/LocalLLaMA/comments/1u9anzk/) (2026-06-18) replayed 500 Claude Code sessions through rtk, headroom and caveman (combined 3.7%).
  - JetBrains and Quesma have published counter-benchmarks.
  - Four "I benchmarked N savers" Reddit posts got fewer upvotes each time: 76, 42, 36, 23.
  - **What is new about saver-audit:**
    1. anyone can run it on *their own* logs with one command;
    2. it covers Claude Code *and* Codex;
    3. it prices savings with cache writes and cache reads taken into account;
    4. it labels each number REPLAY, MODEL or BOUND.
  - Lead with that, credit the earlier work, and answer the obvious objection ("replay can't see behaviour changes") in the post itself.
- **The count in the title is inconsistent.** The launch line says "5 token savers", but the brief names 6: rtk, caveman, headroom, codegraph, fast-jev-compaction and context-mode. codegraph and context-mode can only be *bounded* offline, and fast-jev-compaction can only be *modelled* (see `tech-notes.md` §3). Either say "5" and list exactly which five, or change the number.
- **The launch line is too long for HN.** "I measured 5 token savers on 400 of my own agent sessions. Here's what they really save." is 87 characters. HN's title limit is 80 ([dang](https://news.ycombinator.com/item?id=47404056)), and the "Here's what…" tail is the kind of editorialising that moderators trim.
- **Show HN must link to the tool, not to a blog post.** "Blog posts … are off topic" for Show HN ([showhn.html](https://news.ycombinator.com/showhn.html)). Put the findings in the Show HN text, or submit the write-up as a *separate*, ordinary story.
- **Write the HN text yourself.** dang's Show HN tips (edited 2026-03-28) say: "Write your text by hand. Don't use an LLM to generate any of it (not even a tiny bit, including to edit or spruce it up)" ([item 22336638](https://news.ycombinator.com/item?id=22336638)). The HN guidelines now also say "Don't post generated text or AI-edited text" ([newsguidelines](https://news.ycombinator.com/newsguidelines.html)). Commenters on the comparable threads quickly called out text that read as AI-written (§2.1).
- **Lead with dollars and coverage, not "tokens saved."**
  - Commenters on the rtk threads asked for real bills and accuracy, not token counts ([48588755](https://news.ycombinator.com/item?id=48588755), [49656471](https://news.ycombinator.com/item?id=49656471)).
  - The report and the post should show, for each saver: the share of tokens it could touch, tokens saved, *cache-aware* dollars saved, and whether that number is REPLAY, MODEL or BOUND (`tech-notes.md` §0).
- **The npm name `saver-audit` is free.** `registry.npmjs.org/saver-audit` returned 404 today.
- **Create the GitHub repo and start committing now.** The main awesome list needs "at least 14 days since first commit + further activity", or 100 stars (§6).
- **"Runs" can't be counted without telemetry,** and the product promises that nothing leaves the machine. The one-pager's "2,000+ runs" target has to be read from npm download counts, which also include CI, mirrors and npx cache behaviour. See §8.

---

## 1. Reddit

**How the data was gathered:**
- reddit.com blocks curl and WebFetch, so the pages were read with a headless browser that was **not logged in**, making plain GETs to Reddit's public JSON endpoints: `/r/<sub>/about.json` (members), `/about/rules.json` (rules), `/new.json?limit=100` and `/top.json?t=year` (flairs, formats), `search.json`, and `/api/info.json` (scores).
- **Member counts and rules come from Reddit itself on 2026-09-25, not from a tracker.**
- **Flair lists are inferred.** Reddit's flair endpoint requires login, so flairs are read from the `link_flair_text` of the last 100 posts plus the year's top 40.
- A third-party archive ([Arctic Shift](https://arctic-shift.photon-reddit.com)) was used only to find post IDs. Three of them were cross-checked there too.
- The evidence URL pattern for every row is `https://www.reddit.com/r/<sub>/about.json` and `https://www.reddit.com/r/<sub>/about/rules.json`.

### 1.1 Two findings that change the Reddit plan

1. **The "I replayed my sessions through rtk / headroom / caveman" post has already been done.**
   - r/LocalLLaMA [1u9anzk](https://www.reddit.com/r/LocalLLaMA/comments/1u9anzk/) (2026-06-18, 69 points, 29 comments, flair Resources). The author replayed 500 of their own Claude Code sessions: headroom 2.8%, rtk 0.5%, caveman 0.4%, combined 3.7%.
   - Its top comment is the obvious attack on any offline replay: it doesn't show whether you'd get the same results, or more grepping and tool calls, after the cuts.
   - Four "I benchmarked N token savers" posts followed and each got fewer upvotes than the last: 76, 42, 36, 23.
   - **So the Reddit angle can't be "the claims are wrong"; that is known.** It has to be:
     - (a) *run it on your own logs in one command*;
     - (b) Claude Code **and** Codex;
     - (c) dollars with cache-write and cache-read pricing (1u9anzk found that cache writes plus output made up most of the bill);
     - (d) up front, what replay cannot see.
2. **Reddit's own spam filter removes token-saver promo posts, even high-scoring ones.** These show `removed_by_category: "reddit"`:
   - r/ClaudeAI "6 free open source repos that cut my Claude Code token costs by up to 90%" (822 points);
   - "TUI to see where Claude Code tokens actually go" (880 points).
   - Post from an account with some history, avoid link-only posts, and avoid "cut X%" headlines.

### 1.2 Tier 1: the subs to post in

| Sub | Members (Reddit, 09-25) | Self-promotion rules (from the sub's `about/rules.json`) | Flair to use (inferred) | Format that works (from top/new posts) |
|---|---|---|---|---|
| **[r/ClaudeCode](https://www.reddit.com/r/ClaudeCode/)** | 422,388 | "No Spam or Low-Effort Promotion" (no referral links, disguised ads or repeats). "Simple project sharing belongs in the weekly showcase thread. **Standalone Built with Claude Code posts must be detailed** and explain what you built, how Claude Code was used, and what you learned." Weekly showcase: [1wma6ma](https://www.reddit.com/r/ClaudeCode/comments/1wma6ma/). [rules](https://www.reddit.com/r/ClaudeCode/about/rules.json) | **Built with Claude** (20 of the last 100 posts). Discussion is the alternative | 73% text. Data posts that worked: "i did audit of 926 sessions" 557 pts/138 comments (13k-character text); JetBrains repost 264/73; "I audited my session logs against the usage meter" 200/58. A meta post ([1wcoh39](https://www.reddit.com/r/ClaudeCode/comments/1wcoh39/), 173/88) complains about low-effort "make Opus talk less" posts but asks for "high effort efficiency improvements" |
| **[r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/)** | 1,151,749 | Showcase rule: built with or for Claude **by you**; explain what it does and how Claude helped; free to try and say so; minimal promotional language; **"Posts on the feed now require OP karma>100"**. Competitor comparisons "cannot cite comparative benchmarks without a source". Weekly thread [1wol22c](https://www.reddit.com/r/ClaudeAI/comments/1wol22c/). [rules](https://www.reddit.com/r/ClaudeAI/about/rules.json) | **Built with Claude** (21/100) or **Comparison** | Long text post: TL;DR, method, results table, repo link. "I saved 10M tokens (89%)… with a CLI proxy" 842/188; "Taught Claude to talk like a caveman" 13,452/640 (image) shows the reach ceiling |
| **[r/codex](https://www.reddit.com/r/codex/)** (the OpenAI Codex community; not official) | 208,501 | "High information posts get highest priority." Low-karma posts may go to a delay queue, but "**this does not apply to showcases or any post with high effort useful information**". "Use the right flair." Weekly showcase [1wngv35](https://www.reddit.com/r/codex/comments/1wngv35/). [rules](https://www.reddit.com/r/codex/about/rules.json) | **Comparison** or **Showcase** | Token-saver comparisons do well: "I benchmarked every single usage saving tool" 171/75 (image); "I tested 5… on GPT-5.6 Sol" 136/19; "I parsed 6 months of my Codex logs" 135/46 (image) |
| [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/) | 833,925 | "Limit Self-Promotion: the 1/10th rule… **Affiliation must be disclosed**." "Completely/primarily LLM generated copy… not allowed." Bi-weekly Project Showcase [1wgcpww](https://www.reddit.com/r/LocalLLaMA/comments/1wgcpww/) favours "open source, locally hostable software". [rules](https://www.reddit.com/r/LocalLLaMA/about/rules.json) | **Resources** or **I Built A Thing** | The same-premise post (1u9anzk) is here, so lead with "offline, local, runs on your logs" and link to it |
| [r/ChatGPTCoding](https://www.reddit.com/r/ChatGPTCoding/) | 402,490 | "No pure self-promotion… Delete the link: if nothing is left, it's an ad… GitHub links are fine." A mod post on 2026-08-21 ([1vug6d5](https://www.reddit.com/r/ChatGPTCoding/comments/1vug6d5/)) relaxed this: "tell us what problem they solve… compare them… **We love comparison table**." Weekly thread [1wm6cbp](https://www.reddit.com/r/ChatGPTCoding/comments/1wm6cbp/). [rules](https://www.reddit.com/r/ChatGPTCoding/about/rules.json) | **Resources And Tips** | 90% text; low volume (about 6 posts a day) |
| [r/OpenaiCodex](https://www.reddit.com/r/OpenaiCodex/) | 26,760 | Only "Be respectful" and "Respect Your Neighbors". [rules](https://www.reddit.com/r/OpenaiCodex/about/rules.json) | Showcase / Highlight, or Comparison | Small |

### 1.3 Tier 2: possible, with conditions

| Sub | Members | Condition (quoted or paraphrased from its rules) | Flair |
|---|---|---|---|
| [r/AI_Agents](https://www.reddit.com/r/AI_Agents/) | 448,592 | Text posts only. "**Put your links in the comments, not the posts**"; about 1 in 10 self-promotion; weekly project thread [1woa0r2](https://www.reddit.com/r/AI_Agents/comments/1woa0r2/) | Discussion |
| [r/LLMDevs](https://www.reddit.com/r/LLMDevs/) | 171,824 | Promotion allowed for **FOSS-licensed** projects whose free version is identical (sticky [1mvuw5x](https://www.reddit.com/r/LLMDevs/comments/1mvuw5x/)); undisclosed affiliation can mean a permanent ban; "Provide sources" | **Tools** |
| [r/agenticAI](https://www.reddit.com/r/agenticAI/) | 15,960 | "**Showcase Sundays**: Showcase posts are welcome on Sundays"; under 10% self-promotion | Showcase Sunday |
| [r/aipromptprogramming](https://www.reddit.com/r/aipromptprogramming/) | 238,940 | "**Showcase Sundays**: flair your post with Showcase Sunday and post it on a Sunday", if you contribute the rest of the week; 4 paragraphs or fewer | Showcase Sunday |
| [r/claudeskills](https://www.reddit.com/r/claudeskills/) | 78,935 | "Show your work"; say whether it is free or open source; flair required; bans "posting the same thing across many subs" | Showcase (only if it ships as a skill) |
| [r/coolgithubprojects](https://www.reddit.com/r/coolgithubprojects/) | 121,408 | Sidebar: "Github only"; title format "[Desc] - [Suggested title]"; link posts; reposts only after 6+ months | auto (language) |
| [r/AgentsOfAI](https://www.reddit.com/r/AgentsOfAI/) | 126,773 | "If sharing a project/repo, you must include a detailed text description… Use the comments for links" | I Made This |
| [r/opensource](https://www.reddit.com/r/opensource/) | 384,734 | Must have an OSI licence; "**All AI-generated content is low-effort and ban worthy**"; about 10% self-promotion. Claude-Code posts there scored 0–1 | Promotional (required) |
| [r/SideProject](https://www.reddit.com/r/SideProject/) | 851,967 | No rules in rules.json; sidebar format "[Project name] - [Short description]". A top post asks to "ban AI wrappers" | none |
| [r/LocalLLM](https://www.reddit.com/r/LocalLLM/) | 231,480 | 1/10 rule; closed models "should not be the primary focus" | Project |
| [r/mcp](https://www.reddit.com/r/mcp/) | 122,021 | "Self-promotion is allowed with proper disclosure"; showcase tag | showcase (weak fit) |
| [r/cursor](https://www.reddit.com/r/cursor/) | 157,609 | Under 10% self-promotion; flair required; "No slop". Weak fit unless it reads Cursor logs | Resources & Tips |
| [r/vibecoding](https://www.reddit.com/r/vibecoding/) | 365,618 | "**Vibe coding dev tools must be approved**" through the Vibe Coding Community on X before one "shill" post. Unverified whether that covers a free OSS CLI | Showcase/Project |
| [r/OpenAI](https://www.reddit.com/r/OpenAI/) | 2,871,434 | 1/10 rule; "Self-promotional direct link posts to projects are not allowed… context must be provided in a text post"; top posts are images and news | Discussion |

### 1.4 Tier 3: don't post (rules exclude it)

| Sub | Members | Why |
|---|---|---|
| [r/programming](https://www.reddit.com/r/programming/) | 6,922,342 | "No Product Promotion/'I Made This'". The [AI policy](https://www.reddit.com/r/programming/wiki/ai-policy/) (revised 2026-05-23) removes "a review of a new AI assistant tool"; "No LLM-Written Content" |
| [r/commandline](https://www.reddit.com/r/commandline/) | 132,120 | "No generative AI-related projects… that interacts with… LLMs"; "No new projects newer than 30 days" |
| [r/Anthropic](https://www.reddit.com/r/Anthropic/) | 218,479 | "No spam or self-promotion is permitted." |
| [r/claude](https://www.reddit.com/r/claude/) | 182,705 | "not a place to promote your product, service, or repo" |
| [r/singularity](https://www.reddit.com/r/singularity/) | 3,996,079 | "Self-Promotion/Advertisement posts will not be tolerated." |
| [r/webdev](https://www.reddit.com/r/webdev/) | 3,313,310 | Projects only on "Showoff Saturday"; weak topic fit |
| [r/javascript](https://www.reddit.com/r/javascript/), [r/node](https://www.reddit.com/r/node/) | 2,452,346 / 351,500 | Weak topic fit (top posts are blog and news links) |
| [r/devtools](https://www.reddit.com/r/devtools/) | 1,724 | Too small (top scores 3–24) |
| r/GithubProjects | — | Private or quarantined (HTTP 403) |
| r/ClaudeCodeAgents | — | Does not exist (404) |

### 1.5 Comparable posts

Scores were read from Reddit on 2026-09-25; Reddit fuzzes vote counts.

| Title | Sub | Score | Cmts | Date | Flair / type | Link |
|---|---|---|---|---|---|---|
| Cutting LLM Token Costs with rtk, headroom, and caveman – savings measured on real workloads (**same premise**) | r/LocalLLaMA | 69 | 29 | 2026-06-18 | Resources / link + body | [1u9anzk](https://www.reddit.com/r/LocalLLaMA/comments/1u9anzk/) |
| JetBrains analyzed the CaveMan and RTK token savers, and the results are highly critical | r/ClaudeCode | 264 | 73 | 2026-07-22 | Resource / text | [1v3b81w](https://www.reddit.com/r/ClaudeCode/comments/1v3b81w/) |
| I benchmarked every single "usage saving" tool out there! | r/codex | 171 | 75 | 2026-07-28 | Comparison / image | [1v8zwjl](https://www.reddit.com/r/codex/comments/1v8zwjl/) |
| I tested 5 popular token saving methods across 10 real tasks… (GPT-5.6 Sol version) | r/codex | 136 | 19 | 2026-07-29 | Comparison / text | [1v9xdc5](https://www.reddit.com/r/codex/comments/1v9xdc5/) |
| I tested 5 popular token saving methods across 10 real tasks, and none cut total tokens in both runs | r/ClaudeAI | 76 | 39 | 2026-07-29 | Comparison / text | [1v9xjh0](https://www.reddit.com/r/ClaudeAI/comments/1v9xjh0/) |
| I benchmarked 5 token saving tools across Codex and Claude Code. The 60-90% claims didn't hold up (discloses affiliation) | r/ClaudeCode | 42 | 27 | 2026-08-08 | Discussion / text | [1vilwwm](https://www.reddit.com/r/ClaudeCode/comments/1vilwwm/) |
| I tested 3 more Claude Code plugins to cut costs. Here's my verdict | r/ClaudeAI | 69 | 31 | 2026-09-16 | Claude Code / text | [1whsbju](https://www.reddit.com/r/ClaudeAI/comments/1whsbju/) |
| anthropic isn't the only reason you're hitting claude code limits. i did audit of 926 sessions… | r/ClaudeCode | 557 | 138 | 2026-04-05 | Showcase / text | [1sd8t5u](https://www.reddit.com/r/ClaudeCode/comments/1sd8t5u/) |
| I audited my session logs against the usage meter… | r/ClaudeCode | 200 | 58 | 2026-09-18 | Rant / text | [1wk3zq5](https://www.reddit.com/r/ClaudeCode/comments/1wk3zq5/) |
| Your Codex logs track your quota % on every turn. I parsed 6 months of mine… | r/codex | 135 | 46 | 2026-09-15 | Limits / image | [1wgs7yo](https://www.reddit.com/r/codex/comments/1wgs7yo/) |
| I saved 10M tokens (89%) on my Claude Code sessions with a CLI proxy | r/ClaudeAI | 842 | 188 | 2026-02-12 | Built with Claude / text | [1r2tt7q](https://www.reddit.com/r/ClaudeAI/comments/1r2tt7q/) |
| Taught Claude to talk like a caveman to use 75% less tokens | r/ClaudeAI | 13,452 | 640 | 2026-04-03 | Other / image | [1sble09](https://www.reddit.com/r/ClaudeAI/comments/1sble09/) |
| 6 free open source repos that cut my Claude Code token costs by up to 90% (**removed by Reddit**) | r/ClaudeAI | 822 | 77 | 2026-06-08 | Claude Code Workflow | [1u0m6q8](https://www.reddit.com/r/ClaudeAI/comments/1u0m6q8/) |
| RTK reports huge token savings, but our cost benchmarks disagree (link only) | r/ClaudeCode | 2 | 1 | 2026-09-11 | Discussion / link | [1wdaz21](https://www.reddit.com/r/ClaudeCode/comments/1wdaz21/) |
| Conserving token usage: what are you using today? (the question is still live) | r/ClaudeCode | 4 | 18 | 2026-09-19 | Help/Question | [1wko9op](https://www.reddit.com/r/ClaudeCode/comments/1wko9op/) |

### 1.6 Post format for the main Reddit post

- **Title:** in the "I measured / audited…" family, and not a percentage headline. For example: "I built a one-command offline replay of Claude Code + Codex logs to check token-saver claims. Here's what it found on my N sessions."
- **Body:**
  1. TL;DR (3 lines).
  2. Method: N sessions over D days, which versions, what is replayed and what is modelled, cache-aware pricing.
  3. Results table.
  4. **"What this can't tell you"**: behaviour changes, extra turns, quality. This answers the 1u9anzk objection before anyone raises it.
  5. Credit the prior work: JetBrains, Quesma, 1u9anzk.
  6. Disclosure line: "I built this; it's MIT, free, offline".
  7. Repo and `npx saver-audit` at the end.
- **Images:** one results image or share card helps on r/codex (the image posts there did well). On r/ClaudeCode and r/ClaudeAI, a long text post with a table has worked.
- **Adapt the post to each sub.** Don't copy-paste across subs (r/claudeskills bans it explicitly; the others penalise it through spam filters).
- **Write it by hand.** r/LocalLLaMA, r/opensource, r/programming and r/commandline all ban or penalise LLM-written text.

---

## 2. Hacker News

### 2.1 Comparable posts

Source: the Algolia API (`hn.algolia.com/api/v1/search`), snapshot 2026-09-25, sorted by points. Dates are UTC.

| Pts | Cmts | Date | Title | Link |
|---|---|---|---|---|
| 904 | 366 | 2026-04-05 (Sun) | Caveman: Why use many token when few token do trick | [47647455](https://news.ycombinator.com/item?id=47647455) |
| 706 | 395 | 2026-07-12 (Sun) | Claude Code sends 33k tokens before reading the prompt; OpenCode sends 7k | [48883275](https://news.ycombinator.com/item?id=48883275) |
| 570 | 107 | 2026-02-28 (Sat) | MCP server that reduces Claude Code context consumption by 98% (context-mode) | [47193064](https://news.ycombinator.com/item?id=47193064) |
| 445 | 151 | 2026-05-17 (Sun) | Show HN: Semble – Code search for agents that uses 98% fewer tokens than grep | [48169874](https://news.ycombinator.com/item?id=48169874) |
| 278 | 178 | 2026-09-04 (Fri) | Portal by Spotify cut my Claude Code token usage by 90% | [49571465](https://news.ycombinator.com/item?id=49571465) |
| 245 | 135 | 2025-06-19 (Thu) | Show HN: Claude Code Usage Monitor | [44317012](https://news.ycombinator.com/item?id=44317012) |
| 218 | 118 | 2026-01-28 (Wed) | Show HN: A MitM proxy to see what your LLM tools are sending | [46799898](https://news.ycombinator.com/item?id=46799898) |
| 170 | 84 | 2026-09-11 (Fri) | RTK reports token savings, but our cost benchmarks disagree (Quesma) | [49656471](https://news.ycombinator.com/item?id=49656471) |
| 156 | 80 | 2026-06-05 (Fri) | Show HN: Lowfat – pluggable CLI filter that saved 91.8% of my LLM tokens | [48409955](https://news.ycombinator.com/item?id=48409955) |
| 146 | 100 | 2026-03-09 (Mon) | Show HN: Mcp2cli – 96-99% fewer tokens than native MCP | [47305149](https://news.ycombinator.com/item?id=47305149) |
| 144 | 86 | 2026-03-12 (Thu) | Show HN: Rudel – Claude Code Session Analytics | [47350416](https://news.ycombinator.com/item?id=47350416) |
| 121 | 115 | 2026-06-18 (Thu) | The Token Compression Illusion: Why I'm Skeptical of RTK | [48588755](https://news.ycombinator.com/item?id=48588755) |
| 112 | 27 | 2026-04-13 (Mon) | Show HN: CodeBurn – Analyze Claude Code token usage by task | [47759035](https://news.ycombinator.com/item?id=47759035) |
| 89 | 67 | 2026-04-29 (Wed) | I benchmarked Claude Code's caveman plugin against "be brief." | [47954745](https://news.ycombinator.com/item?id=47954745) |
| 84 | 23 | 2026-02-25 (Wed) | Show HN: Context Mode – 315 KB of MCP output becomes 5.4 KB | [47148025](https://news.ycombinator.com/item?id=47148025) |
| 75 | 30 | 2025-07-18 (Fri) | Ccusage: analyze Claude Code usage from local JSONL files | [44610925](https://news.ycombinator.com/item?id=44610925) |
| 46 | 41 | 2026-07-28 (Tue) | Does Speaking to Agents Like Cavemen Save 65% of Tokens? (JetBrains) | [49080605](https://news.ycombinator.com/item?id=49080605) |
| 18 | 3 | 2026-02-28 (Sat) | Rtk – reduce Claude Code token usage | [47189599](https://news.ycombinator.com/item?id=47189599) |
| 10 | 2 | 2026-07-21 (Tue) | Headroom – compress AI agent input… | [48999841](https://news.ycombinator.com/item?id=48999841) |
| 5 | 0 | 2026-07-26 (Sun) | Codegraph | [49054696](https://news.ycombinator.com/item?id=49054696) |
| 3 | 0 | 2026-09-24 (Thu) | Show HN: compaction.dev makes cc/codex/cursor resend less | [49827661](https://news.ycombinator.com/item?id=49827661) |

**What these posts show:**
- rtk was submitted at least 10 times and never took off.
- fast-jev-compaction has no HN submission.
- Posts that measure something or doubt a claim draw long comment threads: a comment-to-point ratio of about 0.5–1, against about 0.25 for launches.
- **You can't reply in the old threads.** HN "Threads are closed to new comments after two weeks" ([FAQ](https://news.ycombinator.com/newsfaq.html)). The Spotify thread (09-04) is already closed, and the Quesma thread (09-11) closes about now. Link them in your Show HN text instead.

### 2.2 Rules that constrain the Show HN

**From [showhn.html](https://news.ycombinator.com/showhn.html):**
- It must be something people can run.
- It should be easy to try, with no signup.
- It must be your own work, and you must be around to answer comments.
- It must be non-trivial: "Don't post quickly-generated one-offs".
- The title must start with "Show HN".
- Don't ask friends to upvote or comment.

**From the [guidelines](https://news.ycombinator.com/newsguidelines.html):**
- No capitals or exclamation marks used for emphasis.
- No gratuitous numbers.
- No editorialising or linkbait.
- Don't delete and repost.

**From dang's tips ([22336638](https://news.ycombinator.com/item?id=22336638)):**
- Give the backstory and say what is different.
- Link previous HN threads. For this launch that means 49656471, 48588755, 47954745 and 49080605.
- Drop the marketing language.
- Your username should not be the project's name.
- Put an email in your HN profile so a moderator can send a repost invite.

### 2.3 Draft Show HN titles

Character counts are from Python `len`; the dash counts as one character. All are under 80.

1. `Show HN: Saver-audit – replay your Claude Code/Codex logs to test token savers` (78)
2. `Show HN: Measure what RTK, Caveman, Headroom would save on your own agent logs` (78)
3. `Show HN: Saver-audit – offline replay of agent logs to check token-saver claims` (79)

If you also post the write-up as an ordinary story: `I measured 5 token savers on 400 of my own agent sessions` (57). Only use that if the count is fixed as described in §0.

**Suggested first comment,** written by hand:
- how it works (offline replay, what is REPLAY versus MODEL);
- the dataset (how many sessions and days, Claude Code versus Codex);
- 2–3 findings with numbers from your run, including one where a saver *did* help;
- what it cannot measure;
- links to the earlier threads.

### 2.4 Timing

**The data:**
- **Myriade** analysed 157k+ Show HN posts (2009 onward; "success" = 30+ points, the top 10%) ([post](https://www.myriade.ai/blogs/when-is-it-the-best-time-to-post-on-show-hn), [HN 44625897](https://news.ycombinator.com/item?id=44625897)):
  - Sunday is best at 11.75%, then Saturday at 11.08%, against 9.45–9.90% on weekdays.
  - The best hour is 12:00 UTC (12.2%), and 11:00–16:00 UTC is all above 10.5%.
  - Avoid 03:00–07:00 UTC.
- **Alcazar** (2026-03-14): Tue–Thu 14:00–17:00 UTC reaches the biggest audience, and Sunday has less competition; timing is only a marginal factor ([post](https://blog.alcazarsec.com/tech/posts/best-time-to-post-on-hacker-news)).
- **In the table above,** 3 of the top 4 comparable posts went up on a Sunday. That is a small, anecdotal sample.

**Recommendation:** post on a **Sunday at 12:00–14:00 UTC** (08:00–10:00 ET). The fallback is Tue–Thu 14:00–16:00 UTC. Block out the first 4–6 hours to answer comments.

**If it doesn't take off:**
- A small number of reposts is allowed if the story got no significant attention ([FAQ](https://news.ycombinator.com/newsfaq.html)).
- Never delete and repost.
- The second-chance pool is described in [26998308](https://news.ycombinator.com/item?id=26998308). Moderators re-surface overlooked posts, and you can suggest one through the contact link in the HN footer.

---

## 3. X (x.com)

### 3.1 Accounts worth engaging

**How each handle was verified:** by the GitHub profile's `twitter_username` field, by an x.com link on the person's or project's own site or README, or by a public X embed of one of their posts.

Follower counts are left out because the embed data may be cached. No personal contact details are recorded.

**Token-saver authors, and the people who measured them.** Reply to *their* claim posts with your measured number.

| Handle | Who | Why | Verified via |
|---|---|---|---|
| [@rtkailabs](https://x.com/rtkailabs) | rtk (rtk-ai) | 81.7k★. Claims "60–90%"; the most contested numbers in the category | x.com link on [rtk-ai.app](https://www.rtk-ai.app) |
| [@florianbruniaux](https://x.com/florianbruniaux) | Florian Bruniaux, rtk core team | #4 rtk contributor | twitter link on [florian.bruniaux.com](https://www.florian.bruniaux.com/) |
| [@juliusbrussee](https://x.com/juliusbrussee) | Julius Brussee, caveman | 107.8k★, "cuts 65%". A separate @julius_brussee also exists; use the one his own site links | x.com link on [juliusbrussee.com](https://www.juliusbrussee.com) |
| [@chopra_tejas](https://x.com/chopra_tejas) | Tejas Chopra, Headroom founder | Posts Headroom's "tokens saved" totals | tweet embed [x.com/chopra_tejas/status/2026444546419339324](https://x.com/chopra_tejas/status/2026444546419339324) |
| [@getcodegraph](https://x.com/getcodegraph) | codegraph (project) | 72k★, "62% fewer tokens" | x.com link in the [codegraph README](https://github.com/colbymchenry/codegraph) |
| [@tamarajtran](https://x.com/tamarajtran) | Tamara Tran, fast-jev-compaction | Newest breakout (6.8k★ in 8 days) | tweet embed [status/2100694552369897539](https://x.com/tamarajtran/status/2100694552369897539) |
| [@mksglu](https://x.com/mksglu) | Mert Köseoğlu, context-mode | "98% reduction" claim; 570-point HN post | GitHub [mksglu](https://github.com/mksglu) twitter_username |
| [@ryoppippi](https://x.com/ryoppippi) / [@cc_usage](https://x.com/cc_usage) | ccusage author / project | Reads the same local logs; a natural ally, not a rival | GitHub [ryoppippi](https://github.com/ryoppippi); x.com link on [ccusage.com](https://ccusage.com) |
| [@steipete](https://x.com/steipete) | Peter Steinberger, CodexBar (now at OpenAI) | Usage-meter author with very large reach | GitHub [steipete](https://github.com/steipete) twitter_username |
| [@_codeburn](https://x.com/_codeburn), [@TorukMakto1406](https://x.com/TorukMakto1406) | CodeBurn / Resham Joshi | Session-cost analytics (Show HN 112) | x.com link on [codeburn.app](https://codeburn.app); GitHub [iamtoruk](https://github.com/iamtoruk) |
| [@_junhoyeo](https://x.com/_junhoyeo) | Junho Yeo, tokscale | Cross-platform token tracker | GitHub [junhoyeo](https://github.com/junhoyeo) |
| [@jakozaur](https://x.com/jakozaur), [@bartkotrys](https://x.com/bartkotrys) | Jacek Migdal (Quesma CEO), Bartosz Kotrys | Wrote the rtk counter-benchmark; your data extends it to real sessions | footer of the [Quesma post](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/); GitHub [bkotrys](https://github.com/bkotrys) |
| [@SpotifyEng](https://x.com/SpotifyEng) | Spotify Engineering | The "cut my Claude Code tokens by 90%" post | tweet embed [status/2095844320389537996](https://x.com/SpotifyEng/status/2095844320389537996) |
| [@mroczekdev](https://x.com/mroczekdev) | Przemek Mroczek | "The Token Compression Illusion" (121 HN points) | x.com link on [his article](https://mroczek.dev/articles/the-token-compression-illusion-why-im-skeptical-of-rtk/) |
| [@max_t_dev](https://x.com/max_t_dev) | Max Taylor | Benchmarked caveman against "be brief" | x.com link on [maxtaylor.me](https://www.maxtaylor.me/articles/i-benchmarked-caveman-against-two-words) |
| [@jasonzhou1993](https://x.com/jasonzhou1993) | Jason Zhou | Amplified rtk's 60% claim; Quesma cites this tweet | tweet embed [status/2038215854584906078](https://x.com/jasonzhou1993/status/2038215854584906078) |
| [@om_patel5](https://x.com/om_patel5) | Om Patel | The viral "caveman saves 75%" post | tweet embed [status/2040279104885314001](https://x.com/om_patel5/status/2040279104885314001) |
| [@jetbrains](https://x.com/jetbrains) | JetBrains | Published both the rtk and caveman benchmarks | linked from the [JetBrains AI blog](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/) |

**Claude Code and Codex teams, plus official accounts.** Tag them sparingly; only when a finding is directly useful to them, e.g. "built-in X already covers most of what saver Y does".

| Handle | Who | Verified via |
|---|---|---|
| [@bcherny](https://x.com/bcherny) | Boris Cherny, created Claude Code | embed bio "Claude Code @anthropicai" ([status/2003916001851686951](https://x.com/bcherny/status/2003916001851686951)) |
| [@_catwu](https://x.com/_catwu) | Cat Wu, Claude Code product | embed bio "claude code + cowork @anthropicai" |
| [@trq212](https://x.com/trq212) | Thariq Shihipar, Claude Code | GitHub [ThariqS](https://github.com/ThariqS) twitter_username, bio "Claude Code @anthropics" |
| [@ClaudeDevs](https://x.com/ClaudeDevs) | Official Claude developer account | embed shows the Anthropic affiliate badge ([status/2102871550974427462](https://x.com/ClaudeDevs/status/2102871550974427462)) |
| [@claudeai](https://x.com/claudeai), [@AnthropicAI](https://x.com/AnthropicAI) | Official | linked from claude.com and anthropic.com |
| [@thsottiaux](https://x.com/thsottiaux) | Thibault Sottiaux, Codex lead | embed bio "Codex & ChatGPT @OpenAI" |
| [@embirico](https://x.com/embirico) | Alexander Embiricos, Codex | embed bio "Codex @OpenAI"; GitHub [embirico](https://github.com/embirico) |
| [@dkundel](https://x.com/dkundel) | Dominik Kundel, OpenAI DX | GitHub [dkundel](https://github.com/dkundel) twitter_username |
| [@romainhuet](https://x.com/romainhuet) | Romain Huet, OpenAI Head of DX | GitHub [romainhuet](https://github.com/romainhuet) |
| [@jxnlco](https://x.com/jxnlco) | Jason Liu, "dx @openai" | GitHub [jxnl](https://github.com/jxnl) |
| [@OpenAIDevs](https://x.com/OpenAIDevs) | Official ("building with Codex") | linked on [developers.openai.com/codex](https://developers.openai.com/codex) |

**People who review AI coding tools, and newsletter authors.** Whether each one covers this kind of tool is my judgement; the handles are verified.

| Handle | Who | Why | Verified via |
|---|---|---|---|
| [@simonw](https://x.com/simonw) | Simon Willison | Covered ccusage; writes about Claude Code constantly | GitHub [simonw](https://github.com/simonw) |
| [@swyx](https://x.com/swyx), [@latentspacepod](https://x.com/latentspacepod) | Latent Space | 200k+ subscribers; AI engineering | both linked on [latent.space/about](https://www.latent.space/about) |
| [@smol_ai](https://x.com/smol_ai) | AINews | Built from X, Reddit and Discord chatter; covered ccusage | linked on [news.smol.ai](https://news.smol.ai) |
| [@bentossell](https://x.com/bentossell) | Ben Tossell, Ben's Bites | AI builder newsletter | linked on [bensbites.com/about](https://www.bensbites.com/about) |
| [@tldrnewsletter](https://x.com/tldrnewsletter) | TLDR (official) | TLDR Dev ran caveman's claim | linked on [tldr.tech/about](https://tldr.tech/about) |
| [@GergelyOrosz](https://x.com/GergelyOrosz) | The Pragmatic Engineer | Has written about AI-spend cutbacks and "tokenmaxxing" | GitHub [gergelyorosz](https://github.com/gergelyorosz) |
| [@theo](https://x.com/theo) | Theo Browne | Reviews AI coding tools on video | GitHub [t3dotgg](https://github.com/t3dotgg) |
| [@iannuttall](https://x.com/iannuttall) | Ian Nuttall | Covers AI coding tools | GitHub; [ian.is](https://ian.is) |
| [@mckaywrigley](https://x.com/mckaywrigley) | Mckay Wrigley | Demos agent workflows | GitHub [mckaywrigley](https://github.com/mckaywrigley) |
| [@addyosmani](https://x.com/addyosmani) | Addy Osmani | Writes on AI-assisted engineering | GitHub; [addyosmani.com](https://addyosmani.com) |
| [@mattpocockuk](https://x.com/mattpocockuk) | Matt Pocock | AI coding education (AI Hero) | GitHub; [aihero.dev](https://www.aihero.dev) |
| [@levelsio](https://x.com/levelsio) | Pieter Levels | Heavy Claude Code user, very large reach | GitHub; [levels.io](https://levels.io) |

**Could not verify** (so don't tag them):
- rtk maintainers' personal accounts (Patrick Szymkowiak, Adrien Eppling, Nicolas Le Cam);
- Colby McHenry personally;
- the Headroom Labs org account;
- the author of the Spotify post;
- a Quesma org account;
- Rowan Cheung, Dan Ni and Riley Brown personally;
- @literallydenis (the JetBrains benchmark author?).

### 3.2 What kind of post works

**What the ranker rewards:** X's open-sourced ranker ([xai-org/x-algorithm](https://github.com/xai-org/x-algorithm), `home-mixer/params/param.rs`, read today) weights *predicted* actions as follows:
- Reply 5.0 and Quote 5.0.
- Share 2.0, Retweet 1.0, Like 0.5.
- Click 0.4, Open-link 0.2.
- A bidirectional-follow reply gets an extra boost.

The file's own comment warns that these multiply predicted probabilities, not raw counts. What I take from it (my interpretation):
- A post that starts a conversation beats one that collects likes.
- Links are weak, so put the evidence *in* the post as an image and the link in a reply.
- Mute, block and "not interested" are heavily negative, so templated @-mention sprays backfire.

**The launch thread (D0):**
1. One chart: claimed versus measured saving per saver on your sessions, with the replay class marked.
2. One line of method: N sessions, D days, Claude Code + Codex, offline.
3. One surprise, e.g. "the biggest waste wasn't what any saver targets."
4. A reply containing `npx saver-audit` and the repo link.
5. An invitation: "post your share card."

**Reply with data, not promotion:**
- Reply to a saver's *own* claim post with your number for that saver, credit what held up, and invite the maintainer to run it on their logs.
- Quote-post the Quesma and JetBrains studies as "same question, measured on real sessions", not as a dunk.
- Never paste the same reply into several threads.

**Share cards are the engine:** retweet or quote users' share cards and reply to each with one useful observation. This is judgement, but it is consistent with the Reply/Quote weights.

---

## 4. Discords, Slacks and forums

| Community | Where (evidence) | Public? | Size | Channel / section to use | Rules on self-promotion |
|---|---|---|---|---|---|
| **Claude Discord** (official; the server is named "Claude") | [discord.com/invite/6PPFFzqPDZ](https://discord.com/invite/6PPFFzqPDZ), linked from [claude.com/community](https://claude.com/community); anthropic.com/discord redirects there | Yes | about 128.8k members (invite metadata) | claude.com describes it as "project sharing". Channel names unverified (you have to join to see them) | Unverified |
| **OpenAI Developer Community forum** | [Codex category](https://community.openai.com/c/codex/37) (1,320 topics); [Codex CLI](https://community.openai.com/c/codex/codex-cli/39) (258) | Public; account needed to post | "1M+ Developer Forum members" ([developers.openai.com/community](https://developers.openai.com/community)) | Share in [Community](https://community.openai.com/c/community/21) with the `projects` tag | "Share the cool things you have built, but avoid repetitive or overly promotional posts" ([guidelines](https://community.openai.com/guidelines)) |
| **OpenAI Discord** (it also hosts the Codex community) | [discord.gg/openai](https://discord.gg/openai), linked from developers.openai.com/community | Yes (has a verification step) | about 857k | Codex channels unverified | Unverified |
| **openai/codex GitHub Discussions** | ["Show and tell"](https://github.com/openai/codex/discussions) ("Show off something you've made") | Public | 206 threads, newest today | Show and tell. Similar tools post there | GitHub terms |
| **Latent Space Discord** | [discord.gg/xJJMRaWCRt](https://discord.gg/xJJMRaWCRt), from [latent.space/p/community](https://www.latent.space/p/community) | Yes | about 13.3k | Unverified. AINews summarises "top AI discords", so being discussed there can feed AINews | None published |
| **AI Engineer Code Summit** (a talk, not a chat) | CFP at [sessionize.com/aiecode26](https://sessionize.com/aiecode26/); Nov 10–12, 2026, SF, themed "A year of agentic coding" | Open CFP | — | **The final CFP deadline is 2026-10-11**, which falls inside the calendar | — |
| AI Native Dev (Tessl) Discord | [discord.com/invite/jbb2vHnHZQ](https://discord.com/invite/jbb2vHnHZQ), from [tessl.io/community](https://tessl.io/community) | Yes | about 2.2k | "share projects" | None published |
| Cursor forum | [Showcase › Built for Cursor](https://forum.cursor.com/c/showcase/built-for-cursor/19) | Public | 420 topics | Only fits if saver-audit reads Cursor logs | "Include setup instructions and a link to the repo" |
| Hugging Face | [Discord](https://hf.co/join/discord) (about 239k); forum [Show and Tell](https://discuss.huggingface.co/c/show-and-tell/65) | Yes | — | Low fit | — |
| MLOps Community Slack | [go.mlops.community/slack](https://go.mlops.community/slack) (join form) | Via form | "90,000+" ([mlops.community](https://mlops.community)) | Unverified | Unverified |
| dev.to | [#showdev](https://dev.to/t/showdev); tags #claudecode and #codex exist | Public | — | Cross-post the write-up with #showdev | "for showing off projects… not overly corporate or salesy" |
| daily.dev | [Squads](https://docs.daily.dev/public-squads/) | Public | — | Community Picks was sunset in 2025; post to a public Squad | Bans "content used primarily for self-promotion" ([guidelines](https://docs.daily.dev/content-guidelines/)) |
| Lobsters | [lobste.rs/about](https://lobste.rs/about) | **Invite-only** | — | Tags `show` and `vibecoding` | Self-promotion should be "less than a quarter of one's stories and comments"; new users (first 70 days) can't use some tags |
| Tildes | [tildes.net](https://tildes.net) | Invite-only | ~comp 25k | Recurring "what are you working on" thread | "not a free advertising platform" |
| Indie Hackers | [indiehackers.com/products/new](https://www.indiehackers.com/products/new) | Public | — | Product directory | No published rules found |
| Claude community meetups | [luma.com/claudecommunity](https://luma.com/claudecommunity); [ambassadors](https://claude.com/community/ambassadors) | Public | "33 countries, 67 cities" | Demo at a local meetup | — |

- There is no public Discord or Slack for AI Engineer (ai.engineer/community returns 404).
- anthropics/claude-code has no Discussions tab.
- No r/LocalLLaMA Discord was found.

---

## 5. Newsletters, podcasts and blogs

**Only public submission paths are listed.** Where a publication gives an editorial or tips email address, this table links the page that publishes it and does not copy the address.

| Outlet | Size (the outlet's own claim) | How to submit or tip | Has it covered this category? |
|---|---|---|---|
| [Simon Willison's Weblog](https://simonwillison.net) | Not stated | No form. [/about](https://simonwillison.net/about/) lists only social accounts, so the route is being visible on X or Bluesky | **Yes:** [ccusage](https://simonwillison.net/2025/Jul/14/ccusage/) (2025-07-14). Also measured Claude tokenizer ratios ([2026-04-20](https://simonwillison.net/2026/Apr/20/claude-token-counts/)) |
| [Latent Space](https://www.latent.space) (newsletter and podcast) | "Over 201,000 subscribers" | "News tips and pitches" address on [/about](https://www.latent.space/about); guest-post form linked from the same page; about a month's lead time | Via AINews (next row) |
| [AINews](https://news.smol.ai) (smol.ai) | "over 150k" | No form. It is generated from top AI Discords, subreddits and X, so get discussed there | **Yes:** [ccusage](https://news.smol.ai/issues/25-06-20-claude-code/) (2025-06-20) |
| [TLDR Dev](https://tldr.tech/dev) / [TLDR AI](https://tldr.tech/ai) | Dev 470k; AI 1.1M | **No public editorial submission path** (tldr.tech/submit returns 404); sponsorship only | **Yes: caveman's 65% claim ([TLDR Dev 2026-04-06](https://tldr.tech/dev/2026-04-06)).** No rtk, headroom or ccusage in 254 issues from April to September |
| [Console.dev](https://console.dev) | "30k+ subscribers" | Email address on the [selection-criteria page](https://console.dev/selection-criteria). "We do not do sponsored reviews." Criteria: self-service, maintained, documented, privacy impact. An offline tool with no telemetry fits | Not checked |
| [Changelog News](https://changelog.com/news) | "26,711 subscribe" | [changelog.com/news/submit](https://changelog.com/news/submit) (login). "Submitting your own work is also encouraged" | Last issue #185 on 2026-04-29, so a slowed cadence |
| [Changelog podcasts](https://changelog.com/request) | — | Request form (login) | Interviews still active (2026-09-03); Ship It ended in 2024 |
| [JavaScript Weekly / Node Weekly](https://cooperpress.com/publications) (Cooperpress) | JS Weekly "170,000+" | Editorial address on [cooperpress.com/contact](https://cooperpress.com/contact) | Not checked. An `npx` tool fits Node Weekly |
| [The Pragmatic Engineer](https://newsletter.pragmaticengineer.com) | "Over 1,100,000" | Topic-suggestion Google Form linked from the newsletter; no sponsorships | Adjacent: "trying to cut back on AI spend" (2026-05-28), "Tokenmaxxing" (2026-04-16) |
| [Ben's Bites](https://www.bensbites.com) | "Over 171,000" | Sponsor page only | Unverified |
| [The Rundown AI](https://www.therundown.ai) | "2,000,000+" | Advertising only; general audience | Low fit |
| [Hacker Newsletter](https://hackernewsletter.com) | "60,000+" | None; hand-curated from HN, so HN is the route | — |
| [Last Week in AI](https://lastweekin.ai) | "Over 183,000" | Sponsor form only | Not checked |
| [Practical AI](https://practicalai.show) | Not stated | No guest form found | Active (E373 on 2026-09-24) |
| [Software Engineering Daily](https://softwareengineeringdaily.com/contact-us/) | Not stated | Topic suggestions via its contact page | Activity unverified |
| [Import AI](https://importai.substack.com), [Interconnects](https://www.interconnects.ai), [AlphaSignal](https://alphasignal.ai), [Bytes](https://bytes.dev), [Pointer](https://www.pointer.io) | 141k / 84k / not stated / not stated / 60.6k | No public editorial path | Low fit |
| [ClaudeLog](https://claudelog.com) | — | [/contact](https://claudelog.com/contact) points to Reddit and X | Unofficial Claude Code guide, run by an r/ClaudeAI moderator (per the site) |
| [Claude Code Camp](https://www.claudecodecamp.com), [Elite AI-Assisted Coding](https://elite-ai-assisted-coding.dev), [AI Native Dev](https://tessl.io/community) ("50k+ engineers") | — | None found | Adjacent |
| [GitHub ReadME Project](https://github.com/readme) | — | [Nomination form](https://github.com/readme/nominate) (login) | Not checked |

**Takeaway:** the only direct editorial routes are Console.dev, Changelog News, Cooperpress, the Latent Space tips address and the Pragmatic Engineer topic form. Everything else comes from being visible on HN, X, Reddit and Discord.

---

## 6. Directories and lists

| List / directory | Stars · last push | Rules (from the repo's own docs) | When |
|---|---|---|---|
| **[hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)** | 54.6k · 2026-09-25 | **Web issue form only**: [submit](https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml). "Not possible to submit… using the `gh` CLI"; "must be created by human beings". Eligible at (i) 14+ days since the first commit *and* activity after day one, or (ii) 100+ stars. Description: one line, "not a sales pitch", no emojis ([CONTRIBUTING.md](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md)). The fitting category, "Observability & Monitoring > Usage & Cost", already lists ccusage | Day 14 after the first commit, or at 100★ |
| [RoggeOhta/awesome-codex-cli](https://github.com/RoggeOhta/awesome-codex-cli) | 530 · 2026-09-06 | Issue or PR; must be "directly related to Codex CLI", active, one sentence plus a star badge; "self-promotion without substance" refused; no star or age minimum | Launch week |
| [milisp/awesome-codex-cli](https://github.com/milisp/awesome-codex-cli) | 116 · 2026-09-24 | PR; needs "proven external usage… No users yet? Submit once you get adoption." | After traction |
| [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community) | 4.4k · 2026-08-25 (2,282 plugins) | Individuals submit at [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit); run `claude plugin validate` first; pinned to a commit SHA. **It already lists many savers (caveman, context-mode, token-saver, …), so a measuring tool stands out** | Only if you ship a `/saver-audit` plugin or skill |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | 36.8k (314 plugins) | README and [docs](https://code.claude.com/docs/en/plugins/publish) contradict each other; effectively partner-only | Skip |
| [openai/plugins](https://github.com/openai/plugins) (openai/skills is deprecated) | 7.2k | Curated by OpenAI staff; the public route is the [plugin portal](https://developers.openai.com/plugins/deploy/submission), which needs verified identity | Low |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) / [skills.sh](https://skills.sh) | 32.4k | No submission; ranked by `npx skills add` install telemetry | Only if you ship a skill |
| [agarrharr/awesome-cli-apps](https://github.com/agarrharr/awesome-cli-apps) | 20.5k · 2026-09-21 | **Over 3 months old and over 20 stars** (a bot auto-closes PRs that miss either); FOSS; "AI-generated PRs are not welcome"; format `[APP](LINK) - DESCRIPTION.` | About 3 months after launch |
| [filipecalegario/awesome-vibe-coding](https://github.com/filipecalegario/awesome-vibe-coding) | 5.3k · 2026-04-16 | One PR per item; `- [Name](link) - Description.` | Launch week |
| [ai-for-developers/awesome-ai-coding-tools](https://github.com/ai-for-developers/awesome-ai-coding-tools) | 2.1k | Tools must be "AI-powered", which saver-audit is not | Skip |
| [Meirtz/Awesome-Context-Engineering](https://github.com/Meirtz/Awesome-Context-Engineering) | 3.3k · 2026-05-28 | Rules not checked | Maybe |
| [Homebrew core](https://docs.brew.sh/Package-Acceptance-Policy) | — | Third-party submission: 30 forks, 30 watchers or 75 stars. **Self-submitted: 90 / 90 / 225.** Repos under 30 days old are "normally not eligible". A personal tap has no bar | Not needed for `npx`; later |
| [Product Hunt](https://www.producthunt.com/launch) | — | Personal accounts; launch at 12:01 am PT; "You cannot ask people directly to upvote" | **Weak for dev CLIs:** caveman got 166 points and #8 on its day despite 107k★ ([page](https://www.producthunt.com/products/caveman)). Optional, D10+ |
| AlternativeTo, There's An AI For That, Futurepedia | — | Submission flows blocked or unverified | Skip |

**GitHub topics to set** (repo counts today, from GitHub search):

| Topic | Repos |
|---|---|
| `claude-code` | 77,338 |
| `codex` | 33,914 |
| `codex-cli` | 2,798 |
| `context-engineering` | 3,383 |
| `token-optimization` | 1,502 |
| `token-usage` | 1,327 |
| `llm-cost` | 229 |

**npm keywords:**
- **What comparable packages use:**
  - `ccusage` declares **no keywords**.
  - `codeburn` uses claude-code, cursor, codex, ai-coding, token-usage, cost-tracking, observability, developer-tools.
  - `context-mode` uses mcp, claude, claude-code, codex-cli, context-window, and others.
- **How crowded each keyword is** (npm search totals today):
  - claude-code 22,826
  - codex 12,705
  - ai-coding 1,311
  - context-window 581
  - token-optimization 418
  - cost-tracking 404
  - codex-cli 398
  - token-usage 381
  - llm-cost 83
  - token-savings 76
- **Suggestion:** `claude-code, codex, codex-cli, token-usage, token-savings, token-optimization, llm-cost, rtk, caveman, benchmark`. Names like rtk and caveman are what people search for.

---

## 7. 14-day launch calendar

Day 0 = a **Sunday**, the best HN day (§2.4). If the weekend build and your own measurement run finish next week, the first possible Day 0 is **Sunday 2026-10-04**. Dates below assume that. Times are UTC.

### Prep (T-7 to T-1)

- Create the public repo now; awesome-claude-code eligibility starts at the first commit.
- Reserve the `saver-audit` npm name by publishing a working 0.x version.
- Run it on your own sessions and record N sessions, D days and versions for the post.
- Write the Show HN text and the README yourself.
- **README:**
  - one screenshot of the report;
  - one share-card example;
  - a replay-class table;
  - "what this can't measure";
  - a privacy section: "makes no network calls", plus a way readers can check it themselves (e.g. run it with networking disabled, or a CI test that fails on any socket).
- **Launch chart:** claimed vs measured, one bar per saver, labelled REPLAY / MODEL / BOUND.
- Set GitHub topics and npm keywords (§6).
- Put an email address in your HN profile (dang's tip).
- **Reddit account readiness:** r/ClaudeAI requires OP karma over 100, and r/codex queues low-karma posts that are not high-effort. Build history through genuine comments in these subs *before* launch. No vote-trading.

### Calendar

| Day | Date | Channel | Action | Watch |
|---|---|---|---|---|
| D0 Sun | 10-04 | **HN** | 12:00–14:00: Show HN (title from §2.3) plus your hand-written first comment. Stay 4–6 h for comments | Points at 1 h and 3 h; front-page rank |
| D0 | 10-04 | **X** | About 30 min after HN: launch thread (chart, method, surprise, share-card ask); link in a reply. Don't ask for HN votes | Replies and quotes, not likes |
| D1 Mon | 10-05 | **Reddit** | **r/ClaudeCode**: a detailed standalone post, flair "Built with Claude" (format in §1.6). Answer every comment the same day | Score, upvote ratio, comments, removal in the first hour |
| D1 | 10-05 | X | Reply-with-data under the rtk, caveman and Headroom claim posts (one each, unique, credit what held up) | Author responses |
| D2 Tue | 10-06 | Reddit | **r/codex**: flair Comparison or Showcase, with a Codex-specific cut and a results image; not a copy of D1 | Score, comments |
| D2 | 10-06 | Forums | openai/codex Discussions "Show and tell"; OpenAI forum Community + `projects` tag; Claude Discord project-sharing channel | Clicks (GitHub referrers) |
| D3 Wed | 10-07 | Editorial | Console.dev, Changelog News submit, Cooperpress (Node Weekly), Latent Space tips: one factual paragraph and the repo link | — |
| D3 | 10-07 | dev.to | Cross-post the write-up with #showdev #claudecode #codex | Reactions |
| D4 Thu | 10-08 | Product | Ship v0.2 from feedback (a requested saver, a parser fix); reply in the D0/D1 threads with what changed | Issues opened and closed |
| D4 | 10-08 | Reddit | **r/ClaudeAI** (only if your account has more than 100 karma), flair Built with Claude or Comparison, with sources for every comparative number | Score, removal |
| D5 Fri | 10-09 | X | Quote-post the most interesting user share cards, with one observation each | Share-card count |
| D6 Sat | 10-10 | Reddit | r/LLMDevs (flair Tools, FOSS disclosure), or r/LocalLLaMA (Resources; say how this differs from 1u9anzk), adapted, not copied | — |
| D7 Sun | 10-11 | Talk | **AI Engineer Code Summit CFP closes today**; submit "What token savers really save: replaying N real agent sessions". **Midpoint check** against the targets (§8) | Stars/day trend |
| D7 | 10-11 | Reddit | r/agenticAI and/or r/aipromptprogramming: "Showcase Sunday" flair (Sunday-only rule) | — |
| D8 Mon | 10-12 | Awesome lists | awesome-claude-code issue form (eligible if the first commit was 14+ days ago, or 100★); RoggeOhta/awesome-codex-cli; awesome-vibe-coding | Accepted? |
| D9 Tue | 10-13 | X | "Per-saver" deep dive #1 (e.g. rtk: coverage vs savings), with an image and the method | Replies from maintainers |
| D10 Wed | 10-14 | HN | Only if D0 got no real attention: repost the *write-up* (not the Show HN) as an ordinary story, or suggest the Show HN to the second-chance pool. Otherwise skip | — |
| D10 | 10-14 | Product Hunt | Optional, low expectations (§6) | — |
| D11 Thu | 10-15 | Newsletter | Pragmatic Engineer topic form, framed as the story ("what savers really save"), not the tool | — |
| D12 Fri | 10-16 | Meetups | Offer a 5-minute demo to the nearest Claude community meetup (Luma) | — |
| D13 Sat | 10-17 | Review | Retro: metrics vs targets, which channels drove stars (GitHub referrers), and the decision from the one-pager | Final numbers |

**Pacing rules:**
- One major channel per day, so you can answer comments.
- Never post the same text twice.
- Every post carries a number from your own run.
- Don't ask anyone for upvotes; HN, Reddit and Product Hunt all forbid it.

---

## 8. Metrics to watch

**Targets from the one-pager:** 1,000+ stars *or* 2,000+ runs within 14 days means double down; well below that means move on.

| Metric | How to read it (all read-only, no telemetry in the tool) | Notes |
|---|---|---|
| GitHub stars/day | `gh api repos/OWNER/saver-audit --jq .stargazers_count`, sampled daily | Primary target |
| Traffic sources | `gh api repos/OWNER/saver-audit/traffic/popular/referrers` and `/traffic/views` (repo owner only; 14-day window) | Shows which channel worked. **The window is 14 days, so save a copy daily** |
| npm downloads | `https://api.npmjs.org/downloads/range/last-week/saver-audit` | **Stands in for "runs".** Overcounts CI and mirrors; undercounts npx cache hits. Report it as "downloads", not "runs" |
| GitHub Trending | Whether the repo appears at github.com/trending (TypeScript/daily) | The channel that carried the 70k+ repos |
| HN | Points and comments via `hn.algolia.com/api/v1/items/<id>` | Points at 1 h is a good predictor (judgement) |
| Reddit | Score and comments on each post; removals | Watch for mod removal in the first hour |
| X | Replies, quotes and share-card posts by others (manual count) | Share cards are the growth loop |
| Issues and PRs | Count and response time; requests for new savers | Signals whether it sticks after the spike |
| Maintainer responses | Whether rtk, caveman or Headroom maintainers reply or dispute | Disputes are attention, so answer with method and data |

---

## 9. Could not verify / open items

- **Reddit:** flair lists are inferred from recent posts (the flair endpoint needs login). Hidden AutoModerator thresholds are unknown, except r/ClaudeAI's karma over 100 and r/codex's karma queue. r/SideProject, r/node and r/coolgithubprojects have empty rule lists. Whether r/vibecoding's X-approval rule applies to a free OSS CLI is unknown. Rules for r/ChatGPT, r/PromptEngineering and r/ChatGPTPro were not fetched.
- **Discord channel names and rules** for Claude, OpenAI (Codex channels), Latent Space and Hugging Face are visible only after joining. I did not join.
- **The Codex Discord announcement** by @OpenAIDevs was seen only as a search snippet.
- **Other Claude-Code or agentic-coding newsletters** probably exist; finding them needed web search, which ran out.
- **Unverified X handles** are listed at the end of §3.1.
- **Anthropic's official plugin-marketplace route** is contradictory (README vs docs).
- **AlternativeTo, There's An AI For That and Futurepedia** submission flows were blocked.
- **Snapshot drift:** HN points, star counts and member counts are single snapshots from 2026-09-25.

