# 02 — Technical spec

Facts about log formats and each saver's mechanism are collected in `tech-notes.md`.
Read its §0 first; treat the rest as research to verify in M0.

## Rules from the research (must hold)

- **Claude Code logs:** `~/.claude/projects/<cwd>/<session>.jsonl`, plus subagent logs and
  spilled large outputs beside them. The format is internal and changes between versions:
  ignore unknown `type`s, count skipped lines, never crash.
- **Dedupe Claude usage** by `message.id` + `requestId` (one API response is written once
  per content block) and keep the snapshot with the largest totals.
- **Real prompt size** = `input_tokens` + cache write + cache read (`input_tokens` is only
  the uncached remainder).
- **Baseline is what the model saw.** Bash output above about 30k characters appears as a
  `<persisted-output>` preview of about 2 KB; measure savers against that, not the raw
  output (a saver could even put *more* text inline than the baseline).
- **Codex rollouts:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and
  `archived_sessions/`. Usage comes from repeated `token_count` events (dedupe); cached
  tokens are a *subset* of input (the opposite of Claude); most shell work runs through a
  free-form `exec` tool, so parse the command out of the script. Codex rejects input
  rewrites from hooks, so most savers are hypothetical on Codex: label them so.
- **Tokenizer:** no official offline Claude tokenizer exists, and Claude 4.7+ produces
  about 30% more tokens than earlier models. Use o200k_base (`gpt-tokenizer`, MIT) as a
  proxy, calibrated per model family against the logged usage (`tech-notes.md` §4).
- **Prices:** bundle a dated snapshot of models.dev `api.json` (MIT); refresh only with
  `--update-prices`. Derive the 1-hour cache-write price as 2× input.
- **Savers in the launch set** (`tech-notes.md` §3): replayed: rtk (`rtk pipe --filter`,
  partial), caveman engine (call the user's binary), headroom (local model, pre-downloaded);
  modeled: caveman skill, fast-jev-compaction (its real path needs the hosted Jev API, so
  give bounds); upper bound: codegraph, context-mode.

## Architecture

```
src/
  cli.ts              # argument parsing, orchestration, output
  sources/
    claude-code.ts    # find + parse Claude Code session logs
    codex.ts          # find + parse Codex session logs
    types.ts          # normalized Session / Turn / Block model
  accounting/
    tokens.ts         # offline token counting + per-model calibration
    buckets.ts        # where tokens go (prompt, tool output by tool, assistant, cache)
    cost.ts           # price table, cache pricing, compounding context model
  savers/
    index.ts          # registry
    <saver>.ts        # one adapter per saver: method, transform() or estimate()
  report/
    terminal.ts       # the human report
    json.ts           # --json
    card.ts           # --card (SVG rendered to PNG, no network)
data/prices.json      # bundled price snapshot with its date and source
test/fixtures/        # synthetic logs only
```

## Normalized model

```ts
type Source = "claude-code" | "codex";
interface Session { source: Source; id: string; project?: string; model: string; started: string; turns: Turn[] }
interface Turn { index: number; role: "user" | "assistant"; blocks: Block[]; usage?: Usage; compactedBefore?: boolean }
type Block =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; tool: string; input: unknown }
  | { kind: "tool_result"; tool: string; text: string };
interface Usage { input: number; cacheWrite: number; cacheRead: number; output: number }
```

Parsers must tolerate unknown fields and skip malformed lines with a counted warning.

## Token counting

- Recorded `usage` numbers in the logs are the truth for totals.
- To attribute tokens to individual blocks, and to count tokens a saver removes, use an
  offline tokenizer as a proxy, then **calibrate per model**: fit the ratio between the
  proxy count and the recorded usage deltas across the user's own turns. Report the fit
  quality. If calibration is poor for a model, say so in the report.

## Cost model

- Prices per model: input, cache write, cache read, output, from `data/prices.json`.
- **Compounding:** tokens removed from a tool result at turn *t* are no longer in context
  for every later turn until the next compaction. Savings at turn *t+k* include them,
  priced as cache reads when that turn read from cache, as input otherwise. Removing
  tokens also shrinks the cache write where they were first added.
- Output-side savers (those that change the model's writing style) affect output
  tokens. They can only be `modeled`: state the assumed reduction and its source.

## Saver adapters

```ts
interface SaverAdapter {
  id: string; name: string; repo: string; version: string;
  method: "replayed" | "modeled" | "upper-bound";
  appliesTo(block: Block): boolean;
  transform?(block: Block): string;           // replayed: deterministic, offline
  estimate?(turn: Turn): { removedTokens: number; assumption: string }; // modeled
}
```

Replayed adapters should reuse the saver's own filter logic when its licence allows and
it can run offline on recorded text. Otherwise re-implement documented rules and cite
them. Pin the saver version the adapter matches and print it in the report.

## CLI

```
saver-audit [--last 30d | --since 2026-09-01] [--source claude-code|codex|all]
            [--json] [--card [path]] [--show-projects] [--update-prices]
            [--savers rtk,caveman,…] [--verbose]
```

Exit code 0 even when no logs are found; print where it looked.

## Report layout (terminal)

1. Header: period, sessions, sources, models.
2. Where your tokens go: table by bucket, tokens and cost, with bar glyphs.
3. Saver table: tool, method, est. tokens saved, est. cost saved, confidence.
4. Biggest waste: the top 3 tool-output sources by cost.
5. Caveats: behaviour change not measured, calibration quality, price date.

## Performance

A month of heavy use (hundreds of sessions, tens of millions of tokens) in under 10 s.
Stream-parse JSONL files; don't load everything into memory at once.

## Tests

- Golden tests: fixture logs → expected JSON report.
- Adapter tests: each replayed adapter on fixture tool outputs.
- Offline test: runtime code never calls the network.
- Privacy test: the share card and default report contain no fixture text strings.
