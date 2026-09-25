# 03 — Work plan

Time box: a long weekend for M0–M3, a few more days for M4. Don't start a milestone
until the previous one's acceptance checks pass.

## M0 — Ground truth (half a day)

1. Confirm the Claude Code and Codex log locations and schemas on this machine
   (read-only; record field names only, no content). Update `tech-notes.md`.
2. For each saver in `tech-notes.md`, confirm its mechanism from its README and code,
   and decide replayed / modeled / upper bound. Record the decision and the reason.
3. Pick the tokenizer proxy and check the licence.

**Accept:** `tech-notes.md` has a verified section per source and per saver, dated;
STATUS.md lists the savers in scope for the launch (target: rtk, caveman engine and
headroom replayed; caveman skill and fast-jev-compaction modeled; codegraph and
context-mode as upper bounds).

**GATE (human), as early as possible:** create the public GitHub repo (even nearly
empty). awesome-claude-code only accepts repos that are at least 14 days old or have
100+ stars.

## M1 — Where your tokens go (1 day)

1. Parsers for both sources to the normalized model, streaming.
2. Token accounting and calibration; buckets; cost with cache pricing.
3. Terminal report sections 1, 2, 4, 5 and `--json`.

**Accept:** `npm test` passes on synthetic fixtures. On the founder's real logs the
report runs in under 10 s for 30 days, and the totals match the deduplicated recorded
usage sums within 1% (cross-check with ccusage if installed).

## M2 — Saver adapters (1 day)

1. The adapter interface and at least 3 replayed adapters, plus modeled ones where honest.
2. Compounding cost model.
3. Report section 3 with method labels and confidence.

**Accept:** adapter tests pass. On real logs every saver line has a method label, and
the numbers are reproducible across two runs.

## M3 — Share card and README (half a day)

1. `--card` PNG (SVG → PNG offline) with headline numbers only.
2. README with install, a screenshot and **the founder's real measured results**.
3. Privacy test for the card.

**Accept:** a fresh `npx` run from a packed tarball (`npm pack`) works on a clean
directory; the card contains no paths or text from logs.

## M4 — Launch prep (1–2 days)

1. Fill in `04-launch.md` with the real numbers: Show HN post, Reddit posts, X thread.
2. Record a 20–30 second terminal GIF.
3. Prepare npm publish and the public GitHub repo. **GATE (human):** `npm publish`,
   make the repo public, post.

**Accept:** everything in `04-launch.md` is filled in with real numbers; STATUS.md lists
the exact human steps.
