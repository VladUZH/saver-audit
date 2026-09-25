# 04 — Launch

Channel details (subreddits and their rules, X accounts, forums, newsletters,
directories, 14-day calendar) are in `05-distribution.md`.

## The finding is the launch

Launch with a measured result, not a feature list. The "savers save less than claimed"
story is already public (see `01-product.md`), so lead with the personal view:

> "One command shows where your Claude Code and Codex tokens really go, priced with cache
> costs, and what each token saver would actually cut on your own sessions."

Fill in the real numbers after M3 (days of history covered, sessions, where the money
went, which saver would have helped most, the surprise). Show HN titles must be under 80
characters and link to the tool, not a blog post; `05-distribution.md` has three
compliant drafts. Best slot per a 157k-post analysis: Sunday around 12:00 UTC.
The most shareable single fact is a surprise. For example, a popular saver that saved
little, or the waste nobody talks about. Only use what the data shows.

**Hacker News bans AI-written posts and comments. Write the Show HN title, post and
replies yourself; Claude can help you check facts and numbers, not write the text.**

## Assets to prepare (M4)

- README hero: a one-sentence claim, the terminal screenshot, `npx saver-audit`.
- 20–30 s terminal GIF.
- Share card from the founder's own run.
- Show HN fact sheet: the numbers, the method, the caveats and likely questions, for the
  founder to write the title, post and first comment by hand.
- Reddit posts (one per subreddit, written to each one's rules and tone).
- X thread: the finding, the chart, the command, the repo.
- A "post your card" issue or discussion for the community.

## Success measure (set before launch)

Suggested: **1,000+ GitHub stars or 2,000+ runs within 14 days.** Runs can't be counted
without telemetry, so use npm weekly downloads as the proxy. Double down if the target is
reached; otherwise keep the audience and move to bet 2 (offline-ify).

## Human steps (GATE)

0. Create the public GitHub repo early (awesome-claude-code needs 14 days or 100 stars).
   The AI Engineer Code Summit call for talks closes 2026-10-11, if a talk appeals.
1. Push to the public GitHub repo.
2. `npm publish`.
3. Post, following the calendar in `05-distribution.md`.
