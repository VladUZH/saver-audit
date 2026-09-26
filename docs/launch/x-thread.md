# X launch thread: draft (rewrite in your own voice before posting)

A draft for D0 (Sunday 2026-10-04, about 30 minutes after the Show HN). X has no rule against AI-drafted text, but posts read better in your own voice, so treat this as a starting point.

Guidance from 05-distribution §3.2:
- X's ranker weights replies and quotes 10× more than likes;
- the evidence goes *in* the post as an image;
- the link goes in a reply;
- close by asking people to post their cards.

Attach `saver-audit.png` from your final run to post 1.

---

**1/** (image: your share card)
I pointed a small offline tool at 30 days of my own Claude Code + Codex logs.

$4,209 API-equivalent (I don't pay that, it's list price). The biggest line wasn't tool output: 26% was the agent re-reading its own earlier turns from cache.

**2/**
Then I replayed the same sessions through the popular token savers, using my installed copies, offline:

headroom: $151 (3.6%)
lean-ctx: $126 (3.0%)
token-saver: $66 (1.6%)
rtk: $21 (0.5%, a lower bound: its hook also rewrites commands that can't be replayed)
caveman engine: $13 (0.3%)
caveman skill (modeled): $96 (2.3%)

**3/**
Every number carries a label:
- replayed = the saver ran over the recorded text
- modeled = a published measurement + a stated assumption
- ceiling = the tool changes agent behaviour, so only a best case (codegraph ≤ 13.7%, context-mode ≤ 16.7%)

**4/**
Where a saver does help: on Codex, shell output is 44% of the cost. headroom would cut 10.4% of that bill, the biggest measured cut in the run.

**5/**
What offline replay can't show: whether a saver changes how the agent behaves (extra turns, retries, answer quality). The report says that every time.

Credit to JetBrains, Quesma and the r/LocalLLaMA 500-session replay for asking this first.

**6/** (reply with the link)
`npx saver-audit`
Offline, MIT, reads your local logs, writes a numbers-only share card with `--card`.
github.com/VladUZH/saver-audit

What does yours say? Post your card.

---

Before posting:
- **Check the handles.** 05-distribution §3.1 lists unverified ones; don't tag an account you haven't confirmed.
- **Don't @-mention the maintainers in the thread.** Reply-with-data under their own claim posts on D1, one unique reply each.
