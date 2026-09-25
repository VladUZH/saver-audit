# saver-audit: technical ground truth

Checked 2026-09-25. Every fact has a source link. Anything marked **(local)** was confirmed by looking only at the *structure* (key names, value types, record counts) of the JSONL files on this Mac. No text from any real session is copied here. Anything marked **(inference)** is my own reasoning, not a sourced fact.

Local builds inspected:
- **Claude Code** 2.1.219 to 2.1.280, across 1,336 JSONL files.
- **Codex** CLI/Desktop 0.146.0 to 0.148.0-alpha.15, across 1,262 rollouts plus 33 archived ones.

Both builds are newer than most users', so parsers must tolerate missing and unknown fields.

---

## 0. What this means for the build

1. **Claude Code's transcript format is officially unstable.** The docs say the format "is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release" ([sessions](https://code.claude.com/docs/en/sessions)). saver-audit therefore needs:
   - defensive parsing that ignores unknown `type`s;
   - a fixture corpus of structures, synthetic only;
   - a fast release cadence.
2. **Most users have only about 30 days of Claude Code history.** `cleanupPeriodDays` defaults to 30 ([settings-reference](https://code.claude.com/docs/en/settings-reference#cleanupperioddays)). The "400 sessions" in the launch post should say how many days of history it covers. I found no automatic retention limit for Codex.
3. **Dedupe Claude usage by `message.id` + `requestId`.** One API response is written as one line per content block. Keep the snapshot with the largest total, because `output_tokens` on the early lines is a placeholder.
   - Anthropic: [agent-sdk/cost-tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking).
   - ccusage fix: [ccusage#938](https://github.com/ccusage/ccusage/issues/938), [lib.rs](https://github.com/ccusage/ccusage/blob/main/rust/adapters/claude/src/lib.rs).
   - (local): of 49,943 assistant `message.id`s, 38,177 appear on more than one line. Input and cache fields were identical across copies in every case but one. `output_tokens` differed in about 10% of them.
4. **The baseline is what the model saw, not the raw command output.**
   - Claude Code truncates Bash output: about 30k characters inline; above that, a file path plus a preview of about 2,000 characters; failed commands get a head-and-tail excerpt ([tools-reference#output-limits](https://code.claude.com/docs/en/tools-reference#output-limits)).
   - (local): 622 `tool_result` blocks start with the template `<persisted-output>\nOutput too large (<n>KB). Full output saved to: <path>\n\nPreview (first <n>KB):`.
   - A saver can only save on the preview in those cases. A saver that shrinks a 49k output below 30k could put *more* text inline than the baseline did.
5. **Savings must be priced with cache awareness.** A token removed from a tool result is paid once as a cache write, then as a cache read on every later call in the same context until compaction or session end.
   - Both published counter-benchmarks attribute the gap between claimed and billed savings to cached re-reads and extra turns:
     - [Quesma](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/): rtk about 5% cheaper on Fable, about 5% more expensive on DeepSeek.
     - [JetBrains](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/): +7.6% median cost at low effort.
   - saver-audit should report tokens saved *and* dollars saved under the recorded cache pattern (see §6).
6. **Only some savers can be replayed.**
   - **REPLAY:** rtk (via `rtk pipe --filter`), the caveman *proxy* engine and headroom (local model).
   - **MODEL only:** the caveman *skill* (output style) and fast-jev-compaction (needs the hosted Jev API).
   - **Upper bound at most:** codegraph and context-mode, which change agent behaviour.
   - The report must print this class next to each number (§3).
7. **No official offline Claude tokenizer exists.**
   - Claude 4.7 and later use a newer tokenizer that makes about 30% more tokens than the previous one ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
   - Use o200k_base (`gpt-tokenizer`, MIT) as a proxy, calibrated per model family against the `usage` numbers already in the logs (§4).
8. **Prices come from models.dev `api.json`** (MIT, 223 providers). Bundle a snapshot, and refresh only when the user passes an explicit `--update-prices` flag, so the default run makes no network call. models.dev has no 1-hour cache-write field; derive it as 2× input, the same thing ccusage does.

---

## 1. Claude Code session logs

### 1.1 Location, retention, configuration

| Item | Value | Source |
|---|---|---|
| Transcript path | `~/.claude/projects/<project>/<session-uuid>.jsonl`. `<project>` is the cwd with non-alphanumerics replaced by `-`; names over 200 chars are cut and a hash appended | [sessions](https://code.claude.com/docs/en/sessions) |
| Subagent transcripts | `~/.claude/projects/<project>/<session>/subagents/agent-<agentId>.jsonl`. (local): each has an `agent-<id>.meta.json` next to it (keys include `agentType`, `description`, `model`, `toolUseId`, `spawnDepth`). Also `subagents/workflows/<run>/agent-<id>.jsonl` | [sub-agents](https://code.claude.com/docs/en/sub-agents), [claude-directory](https://code.claude.com/docs/en/claude-directory#application-data) |
| Spilled tool output | `<project>/<session>/tool-results/<name>.txt`; "Large tool outputs spilled to separate files" | [claude-directory](https://code.claude.com/docs/en/claude-directory#application-data) |
| Possible duplicate transcripts | `<session>.orphaned-<ts>-<suffix>.jsonl` and `<session>.jsonl.superseded-<ts>`: earlier transcripts set aside. Skip them or dedupe | same |
| Retention | `cleanupPeriodDays`, default 30, minimum 1. Desktop/Cowork sessions are kept unless `desktopSessionCleanupPeriodDays` is set (v2.1.248+) | [settings-reference](https://code.claude.com/docs/en/settings-reference#cleanupperioddays), [data-usage](https://code.claude.com/docs/en/data-usage) |
| Config dir override | `CLAUDE_CONFIG_DIR` (default `~/.claude`) | [env-vars](https://code.claude.com/docs/en/env-vars) |
| Legacy path | ccusage also scans `~/.config/claude/projects/`. The official docs do not mention it | [ccusage adapter README](https://github.com/ccusage/ccusage/blob/main/rust/adapters/claude/src/README.md) |
| Sessions never written | `--no-session-persistence`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` | [sessions](https://code.claude.com/docs/en/sessions) |
| Official alternatives | `/export`, `claude -p --output-format json`, hook `transcript_path`, Agent SDK | same |

### 1.2 Record types (one JSON object per line, discriminated by top-level `type`)

(local) These were observed on 2.1.2xx.

**Core types saver-audit needs:**
- `assistant`
- `user`
- `system`

**Everything else, which saver-audit should ignore:**
- `attachment` (injected reminders and context; `attachment.type` values include `total_tokens_reminder`, `deferred_tools_delta`, `skill_listing` and `hook_additional_context`)
- `file-history-snapshot`, `file-history-delta`
- `queue-operation`
- `ai-title`, `custom-title`, `last-prompt`, `agent-name`
- `mode`, `permission-mode`, `worktree-state`
- `bridge-session`, `frame-link`, `relocated`, `started`, `result`, `cost-state`
- `pr-link`, `fork-context-ref`, `continued-in`, `launched`, `failed`

**Legacy type:** older versions wrote a `summary` type, which was not seen locally.

**Common envelope fields** on `user`, `assistant` and `system` lines (local):
- identity and threading: `uuid`, `parentUuid` (null at a chain root), `sessionId`, `timestamp` (ISO-8601 string), `version` (Claude Code version)
- context: `cwd`, `gitBranch`, `entrypoint` (`cli`, `claude-desktop`, `sdk-cli`), `userType`
- subagents: `isSidechain` (true inside subagent transcripts), `agentId`
- optional: `slug`

### 1.3 `assistant` lines

(local, matching the Messages API shape)

**Message fields:**
- `message.id` and top-level `requestId`: the deduplication key.
- `message.model`: for example `claude-opus-5-5`, `claude-opus-5`, `claude-fable-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`.
  - A `[1m]` suffix also appears, as in `claude-opus-5[1m]`.
  - `<synthetic>` marks locally generated error messages; exclude them from pricing ([ccusage lib.rs](https://github.com/ccusage/ccusage/blob/main/rust/adapters/claude/src/lib.rs)).
- `message.role` = `assistant`.
- `message.stop_reason`: `tool_use`, `end_turn`, `stop_sequence` or `refusal`. It is null on the non-final block lines.

**`message.content[]` has one block per line.** Block types:
- `text` (`text`)
- `thinking` (`thinking`, `signature`). Transcripts store thinking with its text stripped ([codeburn comment](https://github.com/getagentseal/codeburn/blob/main/src/context-tree.ts)), so thinking can't be re-tokenised; only `output_tokens` covers it.
- `tool_use` (`id` of the form `toolu_…`, `name`, `input`). Bash `input` holds `command`, `description` and optionally `timeout` / `run_in_background`. Read holds `file_path` plus optional `offset` / `limit`.

**`message.usage`:**

| Field | Meaning |
|---|---|
| `input_tokens` | Only the *uncached* remainder of the prompt. (local) median 2 per call |
| `cache_creation_input_tokens` | Tokens written to cache on this call |
| `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens` | TTL split of the cache write. Price the 1h part at 2× input and the 5m part at 1.25× |
| `cache_read_input_tokens` | Tokens read from cache. (local) median about 316k per main-session call |
| `output_tokens` | Includes thinking. `output_tokens_details.thinking_tokens` is present on some lines |
| `iterations[]` | Per-iteration usage, e.g. advisor/fallback (`type`: `message`, `fallback_message`). ccusage issue: Fable 5.1 writes `"model": null` there ([ccusage#1710](https://github.com/ccusage/ccusage/issues/1710)) |
| `service_tier`, `speed` (`standard`/`fast`), `inference_geo`, `server_tool_use.{web_search_requests, web_fetch_requests}` | Price modifiers: fast mode, 1.1× for US residency, $10 per 1k web searches |

- The full prompt size of a call is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
- Anthropic documents this usage shape in the [pricing](https://platform.claude.com/docs/en/about-claude/pricing) examples and the [prompt-caching](https://code.claude.com/docs/en/prompt-caching) docs.
- The same usage schema is used by ccusage ([types.rs](https://github.com/ccusage/ccusage/blob/main/rust/crates/ccusage-core/src/types.rs)).

**Other assistant-level fields seen locally (less important):**
- `isApiErrorMessage`, `apiErrorStatus`, `error`
- `effort` (`low` to `xhigh`)
- `message.input_transformations[]` (`type: thinking_dropped`)
- `message.context_management.applied_edits` (rare: 5 lines)
- `message.diagnostics.cache_miss_reason`
- `forkedFrom`

### 1.4 `user` lines: prompts and tool results

- **`message.content`** is either a string (a plain prompt) or a list of blocks:
  - `text`
  - `image` (`source.type: base64`)
  - `tool_result`, with `tool_use_id`, `content` (a string or a list of `text` / `image` / `tool_reference` blocks) and `is_error`.
- **The `tool_result.content` block is what the model saw.** Count this.
- **Top-level `toolUseResult`** is the tool's structured output object (the Agent SDK calls it "the tool's full Output object, not the string content sent to the model"). Do not count it. Use it as the raw-output source for replay.
  - For Bash (local), keys are `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`.
  - Sometimes also: `returnCodeInterpretation`, `persistedOutputPath`, `persistedOutputSize`, `timedOutAfterMs`, `backgroundTaskId`.
  - **There is no numeric exit-code field.** Use `is_error` and `returnCodeInterpretation`.
- **Other flags:**
  - `isMeta` for injected non-user text.
  - `isCompactSummary` plus `isVisibleInTranscriptOnly` for the post-compaction summary message.
  - `sourceToolAssistantUUID` links a result to its assistant line.
  - `promptId`.
  - `origin.kind`.

### 1.5 `system` lines and compaction markers

- **`subtype` values seen locally:**
  - `compact_boundary`
  - `turn_duration`
  - `stop_hook_summary`
  - `local_command`
  - `away_summary`
  - `api_error`
  - `model_refusal_fallback`
  - `informational`
  - `bridge_status`
  - `agents_killed`
  - `scheduled_task_fire`
- **Compaction boundary.** Documented on-disk form: `{"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger":"auto","preTokens":167189}}` ([sub-agents#auto-compaction](https://code.claude.com/docs/en/sub-agents#auto-compaction)).
  - (local) `compactMetadata` also holds `postTokens`, `durationMs`, `cumulativeDroppedTokens`, `preservedSegment{headUuid, anchorUuid, tailUuid}`, `preservedMessages{…}` and `preCompactDiscoveredTools`.
  - `trigger` is `manual` or `auto`.
  - A `logicalParentUuid` links across the boundary.
  - The next `user` line has `isCompactSummary: true`.
- **Hooks.** PreCompact / PostCompact hooks get `trigger` and `custom_instructions`. SessionStart has a `compact` matcher ([hooks](https://code.claude.com/docs/en/hooks)).
- **Compaction cost.** `/compact` sends a separate summarisation request over the full prefix. After the cache TTL has expired, that request is uncached input ([prompt-caching#compacting-the-conversation](https://code.claude.com/docs/en/prompt-caching#compacting-the-conversation)).

### 1.6 What is *not* in the transcript

- **The system prompt, tool definitions, CLAUDE.md, skill listings and MCP schemas** are not stored as text. Their tokens appear only inside the first call's cache write.
  - Estimate that fixed base as `P₁ − tokens(first user message)` (inference).
  - Transforms that act on it (mcp2cli, pxpipe, caveman `shrink`) can only be MODELED.
- **Thinking text** is stripped (§1.3).
- **Cache TTL is not recorded per call, except through the 5m/1h split of `cache_creation`.** Claude Code uses the 1-hour TTL for the main conversation on a subscription within its included usage, and 5 minutes with API-key billing and for subagents. Overrides: `CLAUDE_CODE_PROMPT_CACHE_TTL`, `subagentPromptCacheTtl` ([prompt-caching#cache-lifetime](https://code.claude.com/docs/en/prompt-caching#cache-lifetime)).
- **Subscription users don't pay per token.** Their dollar figures are API-equivalent and must be labelled that way.

---

## 2. OpenAI Codex CLI rollouts

### 2.1 Location

| Item | Value | Source |
|---|---|---|
| Home | `CODEX_HOME`, default `~/.codex` | [home-dir/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs), [env vars doc](https://learn.chatgpt.com/docs/config-file/environment-variables) |
| Rollouts | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<YYYY-MM-DDThh-mm-ss>-<thread_id>.jsonl`, in local time. Reverted threads get the suffix `_<rollout_id>`. (local) confirmed | [recorder.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs), [rollout_file_name.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/rollout_file_name.rs) |
| Archived | `$CODEX_HOME/archived_sessions/rollout-*.jsonl`, a flat directory. (local) confirmed. If a file is in both places, the `sessions/` copy wins | [rollout/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/lib.rs), [ccusage codex README](https://github.com/ccusage/ccusage/blob/main/rust/adapters/codex/src/README.md) |
| Compressed rollouts (coming) | `.jsonl.zst` for rollouts older than 7 days, behind feature `local_thread_store_compression` (under development, off by default). Support zstd anyway | [compression.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/compression.rs), [features/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs) |
| Not useful for tokens | `history.jsonl` (`session_id`, `ts`, `text`; prompts only) and `session_index.jsonl` (`id`, `thread_name`, `updated_at`). (local) confirmed | [message-history/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/message-history/src/lib.rs) |
| Retention | No automatic rollout cleanup setting found: unknown | — |

### 2.2 Line schema

**Line wrapper.** Each line is `RolloutLine = {timestamp, ordinal?, type, payload}`, where `type` is the snake_case `RolloutItem` variant ([history/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/history/src/lib.rs), [rollout_payload.rs](https://github.com/openai/codex/blob/main/codex-rs/history/src/rollout_payload.rs)). The persistence policy is in [policy.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/policy.rs).

| `type` | What saver-audit uses |
|---|---|
| `session_meta` | `id`, `cwd`, `originator` (local: `Codex Desktop`, `codex_exec`, `codex-tui`, `codex_vscode`, …), `cli_version`, `source`, `model_provider`, `forked_from_id`, `parent_thread_id` (subagents), `git{branch, commit_hash, repository_url}`, `base_instructions.text` (the system prompt *is* recorded here, unlike Claude Code) |
| `turn_context` | `model` (the source of truth for pricing), `effort`, `cwd`, `approval_policy`, `sandbox_policy`, `turn_id`. Written once per user turn and again after a mid-turn compaction |
| `response_item` | `payload.type` is one of: `message` (`role` user/assistant/developer; `content[]` of `input_text`/`output_text`/`input_image`), `reasoning` (`summary[]`, `encrypted_content`), `function_call` (`name`, `namespace?`, `arguments` as JSON text, `call_id`), `function_call_output` (`call_id`, `output` as string or `content_items[]`), `custom_tool_call` (`name`, `input` free-form string), `custom_tool_call_output`, `local_shell_call`, `web_search_call`, `tool_search_call`/`_output`, `image_generation_call`, `compaction` |
| `event_msg` | `payload.type` = `token_count` (usage), `task_started` / `task_complete` (turn boundaries, `duration_ms`), `turn_aborted`, `thread_settings_applied` (`service_tier` `priority` means fast, at 2× price), `item_completed` (local; richer per-item record, including `CommandExecution` with `command`, `exit_code`, `aggregated_output`, `parsed_cmd`) |
| `token_usage_record` | New from rust-v0.153.0: per-response `usage`, `turn_token_usage`, `thread_token_usage`, `response_id`. (local) confirmed. ccusage does not parse it yet |
| `compacted` | `message`, `replacement_history[]`, `window_number`, `compaction_response_id`. (local) 589 events |
| Others | `inter_agent_communication(_metadata)`, `world_state`, `retained_context`, `security_risk_score`, `realtime_item`. Ignore them |

Model enum source: [protocol/models.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs). Token types: [protocol.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs).

### 2.3 Token usage semantics

- **`event_msg` of type `token_count`.** Shape: `payload.info = {total_token_usage, last_token_usage, model_context_window}`. `info` may be null for updates that only carry rate limits.
- **`TokenUsage` fields:** `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens` (added in rust-v0.145.0), `output_tokens`, `reasoning_output_tokens`, `total_tokens`.
- **(local) numeric checks on 102,848 events:**
  - `cached_input_tokens ≤ input_tokens` held on every event, so cached tokens are a **subset** of input. This is the opposite of Claude, where `input_tokens` is only the uncached remainder.
  - `total_tokens = input + output` on 99.3% of events, so reasoning is inside `output_tokens`.
  - `cache_write_input_tokens` was always 0 on this machine.
  - 3,767 events repeated the previous cumulative total unchanged.
- **Deduplication rule (ccusage).** Use `last_token_usage` only when `total_token_usage` changed since the previous event. Otherwise use the delta of the cumulative totals, and skip all-zero events. Re-emitted events had inflated usage by about 30–67% ([ccusage#1288](https://github.com/ccusage/ccusage/issues/1288), [#884](https://github.com/ccusage/ccusage/issues/884), [parser](https://github.com/ccusage/ccusage/blob/main/rust/adapters/codex/src/README.md)). On v0.153+, prefer `token_usage_record` (keyed by `response_id`).
- **Subagent and forked rollouts** replay the parent's history first. Exclude usage before the `task_started` / `inter_agent_communication_metadata{trigger_turn:true}` marker (ccusage README).
- **Model fallback.** If there is no `turn_context`, ccusage falls back to `gpt-5` and flags it.
- **`codex-auto-review` has no public price.** ccusage maps it by date: `gpt-5.4` until 2026-07-29, then `gpt-5.6-luna`. (local) This is the most frequent model name on this machine.
- **Overflow events** (source reading, unverified): `fill_to_context_window` can write `total_tokens` = context window with the other fields zero ([context_manager/history.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/context_manager/history.rs)). Don't trust `total_tokens` on its own.

### 2.4 Tool calls to replay

(local) On current builds, most shell work goes through a free-form `custom_tool_call` named `exec`: 49.5k calls here, against 9.1k `function_call` `exec_command` calls.
- The `exec` input is a script that calls `tools.exec_command(...)`, so the shell command has to be parsed out of the script.
- `apply_patch` is also a `custom_tool_call`.
- Older rollouts use `function_call` `shell` or `local_shell_call`.
- Tool outputs start with a header such as `Exit code: <n>\nWall time: <n>\n…` or `Chunk ID: …\nWall time: …`. Strip the header before applying a saver and add it back when counting.
- Codex itself truncates using `APPROX_BYTES_PER_TOKEN = 4` ([truncate.rs](https://github.com/openai/codex/blob/main/codex-rs/utils/string/src/truncate.rs)), so the recorded output is again what the model saw.

**Hook limitation.** Codex rejects PreToolUse input rewrites ([openai/codex#18491](https://github.com/openai/codex/issues/18491), open). caveman and context-mode say they can only *deny* on Codex, while rtk claims a Codex rewrite path. **So on Codex, "would have saved" is hypothetical for most hook-based savers.** Say so in the report.

---

## 3. The token savers

Stars and licences are from `gh api repos/…` on 2026-09-25.

| Tool | Stars | Licence | What it does mechanically | Install | Offline replay class | Log inputs needed |
|---|---|---|---|---|---|---|
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | 81.7k | Apache-2.0 | A PreToolUse hook rewrites Bash commands to `rtk <cmd>`. rtk runs the command and filters, groups, dedupes and truncates the output (63 TOML filters plus Rust filters). **Bash only**; Read/Grep/Glob bypass it ([README "How It Works"](https://github.com/rtk-ai/rtk#what-rtk-does), ["Auto-Rewrite Hook"](https://github.com/rtk-ai/rtk#auto-rewrite-hook)) | `brew install rtk` / cargo / curl, then `rtk init -g` | **REPLAY (partial):** `rtk pipe --filter <name>` applies a filter to stdin ([pipe_cmd.rs](https://github.com/rtk-ai/rtk/blob/master/src/cmds/system/pipe_cmd.rs)), and `rtk rewrite "<cmd>"` maps commands. Caveat: live rtk often changes the command's arguments (`git status --porcelain -b`, `go test -json`), so recorded human-format output is not what its filter parses. rtk's own `rtk discover` only applies static percentages | Bash `input.command`, `tool_result.content` (baseline), `toolUseResult.stdout/stderr` or `persistedOutputPath`, `is_error`, `cwd`, usage and timestamps |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman), **skill** | 107.8k | MIT (skills, CLI) | A prompt rule file that makes the model answer tersely ([SKILL.md](https://github.com/JuliusBrussee/caveman/blob/main/skills/caveman/SKILL.md)). "Input reduction from the skill: 0%", and it adds about 1k input tokens per call ([HONEST-NUMBERS.md](https://github.com/JuliusBrussee/caveman/blob/main/docs/HONEST-NUMBERS.md)) | `npx skills add JuliusBrussee/caveman -g` or the Claude plugin marketplace | **MODEL:** changes model output. Apply a measured ratio to assistant prose (excluding code), minus the added input | assistant `text` blocks, `output_tokens`, call count |
| caveman, **proxy/engine** | (same repo) | **BSL-1.1** for `engine/`, `proxy/`, `shrink/` and others; converts to Apache-2.0 on 2030-06-21 ([LICENSING.md](https://github.com/JuliusBrussee/caveman/blob/main/LICENSING.md)) | A local proxy with 15 content-type compressors (json, log, code, diff…); originals go to SQLite and are retrievable ([README "The proxy, unpacked"](https://github.com/JuliusBrussee/caveman#-the-proxy-unpacked)). Deterministic Go; token estimates use o200k_base | `npm i -g @caveman-ai/cli`, `caveman claude` | **REPLAY:** `caveman-engine compress` via stdin. Call the user's installed binary; don't bundle BSL code | tool_result contents, request sequence |
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | 73.8k | Apache-2.0 | A proxy/wrapper/library. ContentRouter uses SmartCrusher (JSON), CodeCompressor (AST) and Kompress-v2 (a local ModernBERT ONNX model from HF). CacheAligner keeps the cached prefix stable. Optional output shaper ([README "How it works"](https://github.com/headroomlabs-ai/headroom#how-it-works)). Telemetry beacon on by default | `uv tool install "headroom-ai[all]"`, `headroom wrap claude` | **REPLAY:** offline once the model is pre-downloaded. It already ships a session-replay benchmark ([claude_session_mode_benchmark.py](https://github.com/headroomlabs-ai/headroom/blob/main/benchmarks/claude_session_mode_benchmark.py)). An exact replay must emulate live-zone compression | rebuilt per-request message arrays, timestamps, model |
| [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) | 72.1k | MIT | A tree-sitter code graph in local SQLite, served as one MCP tool `codegraph_explore`, so the agent reads fewer files ([How It Works](https://github.com/colbymchenry/codegraph#how-it-works)). Its own caveat: about 80% more retrieval context stays resident in long sessions | curl or `npm i -g @colbymchenry/codegraph`, then `codegraph install` | **NOT MEASURABLE** (it changes behaviour). At most an upper bound on exploratory Grep/Glob/Read tokens | tool names, inputs, result sizes |
| [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) | 6.8k | MIT | Replaces Claude Code compaction. For each old tool call/result pair it asks the hosted **Jev** model (TypeSafe, `api.typesafe.ai`, needs `TYPESAFE_API_KEY`) whether to keep or drop, then keeps, truncates to 300 characters, or drops. Falls back if the reduction is under 25% ([README "How it works"](https://github.com/tamaratran/fast-jev-compaction#how-it-works)). Needs early-access function hooks, 2.1.274+ | Claude plugin marketplace | **MODEL:** needs a network call. Give bounds: lower = built-in summary; upper = every old result cut to 300 characters | transcript before each `compact_boundary`, tool pairs, `compactMetadata.pre/postTokens` |
| [mksglu/context-mode](https://github.com/mksglu/context-mode) | 24.1k | **Elastic License 2.0** (not OSI) | An MCP sandbox: the agent runs code and only stdout enters context. Outputs over 5KB are indexed (FTS5/BM25). Hooks reroute curl/wget/build tools ([README](https://github.com/mksglu/context-mode#how-context-mode-solves-it)) | `/plugin marketplace add mksglu/context-mode` | **NOT MEASURABLE** (behaviour change). Upper bound over routed categories only | tool name/input, result sizes |

**Other 2026 savers over 5k stars:**
- **Code-index class, NOT replayable:**
  - [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), 44.9k, MIT
  - [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph), 31.8k, MIT
  - [trailhq/Graft](https://github.com/trailhq/Graft), 9.2k, MIT
  - [MinishLab/semble](https://github.com/MinishLab/semble), 6.1k, MIT
- **[teamchong/pxpipe](https://github.com/teamchong/pxpipe)** (7.4k, MIT): renders context as images. MODEL or partial replay, because system and tool text is missing from Claude logs.
- **[drona23/claude-token-efficient](https://github.com/drona23/claude-token-efficient)** (6.1k, MIT): output-style CLAUDE.md. MODEL. Its own reproducible bench shows about 4–12% output cuts.
- **[weave-os/router](https://github.com/weave-os/router)** (5.2k, Apache-2.0): a model router that saves cost, not tokens. MODEL by re-pricing.
- **Relevant but under 5k stars:**
  - [knowsuchagency/mcp2cli](https://github.com/knowsuchagency/mcp2cli), 2.4k, MIT: tool-schema slimming. MODEL, because schemas are not in the logs.
  - [spotify/portal-ai-plugins](https://github.com/spotify/portal-ai-plugins) "shunt", 2.3k, Apache-2.0: routes bulk reads to a worker LLM. MODEL.

**Published independent measurements:**
- **rtk:**
  - JetBrains: +7.6% median cost at low effort (p=0.004), about 0 at high effort. Only 33% of Bash calls went through the hook ([blog](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/)).
  - Quesma: about 5% cheaper on Fable, mostly from one task; about 5% more expensive on DeepSeek ([blog](https://quesma.com/blog/does-rtk-make-ai-coding-cheaper/), [HN](https://news.ycombinator.com/item?id=49656471)).
- **caveman skill:** JetBrains measured −8.5% output tokens against an advertised −65% ([blog](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/)).
- **Output vs input compression generally:** Adobe's CAVEWOMAN paper found that compressing *output* cut cost 1.4–2.4×, while compressing *input* raised it about 1.15× on average ([arXiv 2606.24083](https://arxiv.org/abs/2606.24083)).
- **headroom, codegraph, context-mode, fast-jev-compaction:** no independent benchmark found.

**Built-in Claude Code features that overlap, and so shrink every saver's headroom:**
- MCP tool search (deferred tool definitions)
- MCP output cap of 25k tokens
- Bash output cap of about 30k characters
- auto-compact and `/context`
- the preprocessing-hook example in the docs, which is essentially rtk-lite

Sources: [mcp](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search), [tools-reference](https://code.claude.com/docs/en/tools-reference#output-limits), [costs#reduce-token-usage](https://code.claude.com/docs/en/costs#reduce-token-usage).

---

## 4. Offline token counting and calibration

### 4.1 Tokenizers

| Option | Covers | Licence | Notes |
|---|---|---|---|
| [`gpt-tokenizer`](https://github.com/niieani/gpt-tokenizer) (npm 4.0.0, 2026-08-16) | All OpenAI encodings including `o200k_base` and `o200k_harmony`; per-model modules up to gpt-5.6-* | MIT | Pure TS, no WASM, about 1.37M downloads/week. **Recommended default** |
| [`js-tiktoken`](https://github.com/dqbd/tiktoken) 1.0.21 | Up to o200k_base; no harmony; model map stops at gpt-5 | MIT | About 5.7M downloads/week, but stale since 2025-08 |
| [`tiktoken`](https://github.com/openai/tiktoken) (Python 0.14.0) | `gpt-5*` maps to `o200k_base` by prefix (fail-open, #596); **no gpt-6 entry** | MIT | Reference implementation |
| [`@anthropic-ai/tokenizer`](https://github.com/anthropics/anthropic-tokenizer-typescript) 0.0.4 | Pre-Claude-3 only. README: "no longer accurate… rely on `usage`" | npm says Apache-2.0; repo says MIT. Archived | Don't use |
| Anthropic `count_tokens` API | Exact-ish for every Claude model | — | **Needs network and an API key.** Opt-in calibration only ([token-counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)) |

**Facts that drive accuracy:**
- **OpenAI.** gpt-5.x maps to o200k_base in tiktoken's model map, so Codex counts should be close to exact. For gpt-6-*, no official tokenizer statement was found ([gpt-6-sol page](https://developers.openai.com/api/docs/models/gpt-6-sol)), so treat it as o200k_base and calibrate.
- **Claude has two tokenizer generations:**
  - ≤4.6 (Opus 4.6 and earlier, Sonnet 4.6 and earlier, Haiku 4.5);
  - 4.7+ (Opus 4.7/4.8/5/5.5, Sonnet 5, Fable, Mythos).
  - The newer one gives "approximately 30% more tokens for the same text" ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)); Anthropic's Opus 4.7 announcement says 1.0–1.35× ([news](https://www.anthropic.com/news/claude-opus-4-7)).
  - Simon Willison measured 1.46× on a system prompt and 1.08× on a PDF ([blog](https://simonwillison.net/2026/Apr/20/claude-token-counts/)).
  - The Opus 5.5 docs give "1M tokens ≈ 2.5M Unicode characters" ([overview](https://platform.claude.com/docs/en/models/opus-5-5/overview)).
- **No published measurement of Claude 4.7+ against o200k_base was found.** The ratio must come from calibration, not a constant.

### 4.2 Calibration against the logs (inference, method proposal)

1. **Claude Code, per API call.**
   - Deduplicate by `message.id` + `requestId`.
   - Let Pᵢ = `input + cache_creation + cache_read` for call *i*.
   - For consecutive calls in the same file, same `parentUuid` chain, same model, no `compact_boundary` between them, and not a sidechain: the appended tokens are Aᵢ ≈ Pᵢ₊₁ − Pᵢ − Oᵢ, where Oᵢ is the final `output_tokens`.
   - This holds on "keep-all-thinking" models (Opus 4.5+, Sonnet 4.6+, Fable, Mythos), where earlier thinking stays in context ([thinking](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-block-preservation-by-model)).
2. **Fit the ratio.** Let Lᵢ be the o200k count of the appended `tool_result` / user blocks. Fit Aᵢ ≈ k·Lᵢ + c·nᵢ (nᵢ = number of blocks) with a robust regression (Theil–Sen or Huber):
   - separately per tokenizer generation and content class (code, JSON, logs, prose);
   - dropping pairs with Lᵢ below about 200, and negative deltas (context edits);
   - reporting *k* with a bootstrap confidence interval and the held-out error.
3. **Codex.** Per response, use `token_usage_record.usage`, or the delta of the cumulative `token_count`. Here `input_tokens` already includes cached tokens. Expect k ≈ 1 on gpt-5.x. Whether earlier `encrypted_content` reasoning is billed as later input is **unknown**.
4. **Print both numbers.** The report shows the calibrated and uncalibrated estimates and the fitted *k* per model, so readers can judge the accuracy.

**Prior art.** None of these fits a correction factor:
- ccusage only does accounting.
- codeburn uses chars/4 ([token-estimate.ts](https://github.com/getagentseal/codeburn)).
- tokscale uses LiteLLM prices.
- rtk counts bytes/4.

---

## 5. List prices (USD per 1M tokens, standard tier, checked 2026-09-25)

### 5.1 Anthropic ([pricing](https://platform.claude.com/docs/en/about-claude/pricing), re-fetched and confirmed today)

| Model | Input | 5m cache write | 1h cache write | Cache read | Output |
|---|---|---|---|---|---|
| Claude Fable 5.1 | 10 | 12.50 | 20 | 0.25 (0.025×) | 50 |
| Claude Fable 5 | 10 | 12.50 | 20 | 1.00 | 50 |
| Claude Opus 5.5 | 4 | 5 | 8 | 0.20 (0.05×) | 20 |
| Claude Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 | 5 | 6.25 | 10 | 0.50 | 25 |
| Claude Sonnet 5 | 2 | 2.50 | 4 | 0.20 | 10 |
| Claude Sonnet 4.6 / 4.5 | 3 | 3.75 | 6 | 0.30 | 15 |
| Claude Haiku 4.5 | 1 | 1.25 | 2 | 0.10 | 5 |

- **Sonnet 5's $2/$10 is now the standard price;** the planned increase will not happen.
- **Fast mode:** Opus 5.5 is $8/$40; Opus 5 and 4.8 are $10/$50.
- **Data residency:** `inference_geo: "us"` costs 1.1×.
- **Long context:** Claude 4.6+ has no >200k premium (full 1M window at standard price). LiteLLM still lists the old premium for Sonnet 4.5: $6 / $22.50.

### 5.2 OpenAI ([pricing](https://developers.openai.com/api/docs/pricing))

| Model | Input | Cached input | Cache write | Output | Above 272K input (in / cached / write / out) |
|---|---|---|---|---|---|
| gpt-6-astra | 10 | 1.00 | 12.50 | 50 | 20 / 2 / 25 / 75 |
| gpt-6-sol | 2 | 0.20 | 2.50 | 10 | 4 / 0.40 / 5 / 15 |
| gpt-6-luna | 0.10 | 0.01 | 0.125 | 0.50 | 0.20 / 0.02 / 0.25 / 0.75 |
| gpt-5.6-sol | 4 | 0.40 | 5 | 20 | 8 / 0.80 / 10 / 30 |
| gpt-5.6-terra | 2 | 0.20 | 2.50 | 12 | 4 / 0.40 / 5 / 18 |
| gpt-5.6-luna | 0.20 | 0.02 | 0.25 | 1.20 | 0.40 / 0.04 / 0.50 / 1.80 |
| gpt-5.5 | 5 | 0.50 | — | 30 | 10 / 1 / — / 45 |
| gpt-5.4 | 2.50 | 0.25 | — | 15 | 5 / 0.50 / — / 22.50 |
| gpt-5.3-codex | 1.75 | 0.175 | — | 14 | (max input 272k) |
| gpt-5.2 | 1.75 | 0.175 | — | 14 | — |
| gpt-5.1 / gpt-5 | 1.25 | 0.125 | — | 10 | — |

- **OpenAI now charges for cache writes on GPT-5.6 and later,** at 1.25× input ([prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)). GPT-5.5 and earlier have no write charge.
- **Priority/fast tier costs 2×.** Batch and flex cost 0.5×.
- **Retired Codex models need archived prices:** gpt-5-codex, gpt-5.1-codex(-max/-mini) and gpt-5.2-codex were shut down 2026-07-23 ([deprecations](https://developers.openai.com/api/docs/deprecations)). LiteLLM still carries their prices.

### 5.3 Machine-readable price lists

- **[models.dev](https://models.dev/api.json)** (repo [anomalyco/models.dev](https://github.com/anomalyco/models.dev), MIT).
  - `api.json` returned HTTP 200 today: 223 providers, about 4.9 MB.
  - Structure: `provider → models → modelId → cost{input, output, cache_read, cache_write, …}` in USD per 1M tokens, plus `tiers[]` (e.g. context > 272000) and `limit{context, output}`.
  - Spot-checked today, all matching the official pages: `claude-opus-5-5` 4/20/0.2/5, `claude-sonnet-5` 2/10/0.2/2.5, `claude-fable-5-1` 10/50/0.25/12.5, `gpt-5.6-terra` 2/12/0.2/2.5 (tier 4/18/0.4/5), `gpt-6-sol` 2/10/0.2/2.5.
  - **Gaps:** one `cache_write` field (the 5m rate), with **no 1h cache-write rate**, so use 2× input; no `codex-auto-review`.
- **[LiteLLM `model_prices_and_context_window.json`](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)** (MIT outside `enterprise/`).
  - Per-token fields, including `cache_creation_input_token_cost_above_1hr` and `*_above_200k_tokens` / `*_above_272k_tokens`.
  - Keeps retired models.
  - ccusage embeds snapshots of both and prices 1h writes at 2× input ([pricing.rs](https://github.com/ccusage/ccusage/blob/main/rust/crates/ccusage-core/src/pricing.rs)).
- **Recommendation.** Ship a dated snapshot of models.dev with LiteLLM as a fallback for retired models. Print the snapshot date in every report. Fetch fresh prices only with an explicit flag.

---

## 6. Replay-and-price method (inference, for the design doc)

**Pricing one transform.** For a transform that changes a tool result at call *i* by Δ tokens (baseline minus transformed, both in the model's tokens after calibration):

- **Cost of that result under the recorded pattern:**
  - Δ × (write rate) when it is first cached: 5m or 1h, taken from the `cache_creation` split;
  - plus Δ × (cache-read rate) × (number of later calls in the same context before the next `compact_boundary` or session end);
  - or Δ × input rate when it wasn't cached.
- **Where it stops:** Δ does not carry into post-compaction context, except through the summary, which is not replayable.
- **Output-style savers (caveman skill):**
  - Δout × output rate;
  - plus the saved output tokens re-read as cache in later calls;
  - minus (skill size × cache-read rate × number of calls).

**What the report must separate:**
- **Tokens the model saw.** Counted on the `tool_result.content` actually sent, not the raw stdout.
- **Replay class per saver.** REPLAY, MODEL or UPPER BOUND.
- **Coverage.** The share of tool-output tokens the saver could touch at all, e.g. Bash only for rtk.
- **What can't be measured offline.** Behaviour changes: extra turns, retrieve or recall calls, and pass-rate effects.

This matches the lesson from the JetBrains and Quesma posts: tokens saved at the filter do not equal dollars saved on the bill.

---

## 7. Open questions

1. Does the last line for each `message.id` always carry the final `output_tokens`? Interrupted streams may leave only the placeholder. Take the max across copies.
2. Does Claude Code clear old tool results mid-session? That would produce negative Pᵢ₊₁ − Pᵢ deltas. (local) `message.context_management.applied_edits` exists but appeared only 5 times; the docs mention "clearing old tool results" without details ([costs](https://code.claude.com/docs/en/costs#prompt-cache-statistics)).
3. Is Codex's earlier reasoning (`encrypted_content`) billed as input on later calls? Unknown.
4. Which tokenizer do gpt-6-* models use? Not stated officially.
5. How to parse Codex `exec` custom-tool scripts into shell commands robustly? The format is undocumented. Fixtures from several versions are needed.
6. Can the caveman engine be invoked by users under BSL-1.1? It is fine for the user's own local use under the Additional Use Grant. Don't redistribute it.
7. Claude Code Desktop/Cowork sessions are kept forever by default, while CLI sessions last 30 days. Mixed-age corpora will skew toward Desktop.

---

## 8. M0 verification on this machine (2026-09-25)

Method: `node scripts/probe-schema.mjs claude|codex` (prints key paths, value types,
counts and a whitelist of discriminator values; masks non-identifier keys; never prints
text) plus a one-off numeric check of usage fields. Local tools: Claude Code 2.1.282,
codex-cli 0.146.0, Node 24.3.0. No `CLAUDE_CONFIG_DIR` / `CODEX_HOME` overrides set.

### 8.1 Claude Code: verified

- **Location confirmed:** `~/.claude/projects/**.jsonl`, 1,349 files (1,281 under
  `<session>/subagents/`), 571 files under `<session>/tool-results/`. No
  `.orphaned-*` / `.superseded-*` files and no `~/.config/claude/projects` here, so the
  skip rule for those stays untested locally (cover it with a fixture).
- **Versions seen:** 2.1.156 to 2.1.282. 303,018 lines, **15 unparseable** (the parser
  must count and skip these, as planned).
- **Record types** match §1.2. New ignorable types since the research pass:
  `atis-latch`, `artifact-autoreact-ledger`, `artifact-comment-monitor`. New content
  block type on assistant lines: `fallback` (4 blocks). Unknown types must stay ignored.
- **Models seen:** `claude-opus-5-5`, `claude-opus-5`, `claude-fable-5`,
  `claude-fable-5-1`, `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`,
  `<synthetic>` (318 lines; exclude from pricing).
- **Usage fields** exactly as §1.3 on all 121,460 assistant lines:
  `input_tokens`, `cache_creation_input_tokens`, `cache_creation{…}`,
  `cache_read_input_tokens`, `output_tokens`; `output_tokens_details.thinking_tokens`
  on a subset; `iterations[]` (`message`, `fallback_message`); `server_tool_use`,
  `speed` and `service_tier` (all `standard` here); `inference_geo`.
- **Dedupe:** 49,509 unique `message.id|requestId` keys; 38,524 span several lines.
  Input/cache fields differed between copies in **6** keys (not 1), `output_tokens` in
  3,809. **Rule: take the max of each usage field across copies.** 41 assistant lines
  have no `requestId`; key those on `message.id` alone.
- **Tool results:** 73,491 `tool_result` blocks; `content` is a string (66,631) or a
  list (6,848) of `text` / `image` / `tool_reference` / `document` blocks. **569** start
  with `<persisted-output>` (baseline = the preview, per §0.4). `toolUseResult` Bash keys
  confirmed: `stdout`, `stderr`, `interrupted`, plus rare `persistedOutputPath` /
  `persistedOutputSize` (40) and `returnCodeInterpretation` (83). No exit-code field.
- **Compaction:** 46 `compact_boundary` lines (`manual` 36, `auto` 10) with
  `compactMetadata.{trigger, preTokens, postTokens, durationMs, cumulativeDroppedTokens,
  preservedSegment, preservedMessages, preCompactDiscoveredTools}`; 46
  `isCompactSummary: true` user lines.
- **Tool mix (tool_use names):** Bash 29,296; WebFetch 28,777; MCP tools 5,265
  (names masked); Read 3,090; Edit 2,269; Write 1,096; WebSearch 1,037; long tail of
  built-ins. Buckets must handle a heavy WebFetch share, not just Bash/Read.

### 8.2 Codex: verified

- **Location confirmed:** 1,262 rollouts under `~/.codex/sessions/YYYY/MM/DD/` plus 33
  in `archived_sessions/`; no `.zst` files yet. 553,183 lines, **28 unparseable**.
- **Versions seen:** 0.70.0-alpha.4 to 0.155.0-alpha.16.3 (session_meta `cli_version`).
- **Line wrapper and types** match §2.2: `response_item`, `event_msg`, `turn_context`,
  `session_meta`, `compacted` (631), `token_usage_record` (297), plus ignorable
  `inter_agent_communication_metadata` (with `trigger_turn`) and `world_state`.
- **Models seen (turn_context):** `codex-auto-review` (most frequent), `gpt-5.6-sol`,
  `gpt-5.3-codex`, `gpt-5.6-terra`, `gpt-5.5`, `gpt-5.4`, `gpt-6-astra`, `gpt-5.6-luna`,
  `gpt-5`, `gpt-5.2`, `gpt-5.1`, `gpt-5.1-codex(-mini/-max)`, `gpt-4.1-nano`,
  `gpt-4.1-mini`. Price table needs archived prices for the retired ones.
- **token_count:** 108,091 events with `info` (40 with `info: null`).
  `cached_input_tokens ≤ input_tokens` on **every** event (cached is a subset of input,
  confirmed). `total = input + output` on 107,329 (99.3%). `cache_write_input_tokens`
  is 0 on every event. 4,106 events repeat the previous cumulative total (dedupe rule in
  §2.3 stands).
- **Tool calls:** `custom_tool_call` `exec` 51,619 (free-form script) vs
  `function_call` `exec_command` 9,132; `apply_patch` 3,076; agent tools
  (`wait_agent`, `send_message`, `spawn_agent`, …) are frequent. `function_call_output.output`
  is a string (30,915) or an array (52,267): handle both.

### 8.3 Performance note

A full scan of *all* local history (about 2 GB per source) with plain `JSON.parse`
took about 15–21 s wall time per pass. For the 10 s / 30-day target the parser must skip
files whose mtime is before the period start, and avoid parsing record types it ignores
(cheap prefix check on `"type":`) where possible.

### 8.4 Tokenizer choice

- **`gpt-tokenizer` 4.0.0** (MIT, zero dependencies, published 2026-08-16) confirmed.
  `o200k_base` counted about 47 MB/s of synthetic mixed text on this Mac (Node 24).
- Its npm tarball is **9.1 MB** (27 MB unpacked, all encodings). Importing only
  `gpt-tokenizer/encoding/o200k_base` and bundling it into `dist/` at build time keeps
  the published package to that one encoding (about 2.4 MB of ranks) with zero runtime
  dependencies. Its MIT notice must ship in the package.

### 8.5 Savers: verified from README and source (2026-09-25)

Read from shallow clones at pinned commits; nothing was installed or executed. Commits:
rtk `feac25d` (branch `develop`; `pipe_cmd.rs` identical at tag v0.50.0), caveman
`2fd153c`, headroom `3aa5012`, codegraph `ba3c21e`, fast-jev-compaction `e3f262a`,
context-mode `e80601e`. File/line references below are at those commits.
**None of these tools is installed on this machine** (checked with `command -v`).

| Saver | Version | Licence | Class | Replay command / basis |
|---|---|---|---|---|
| rtk | v0.50.0 (2026-09-24) | Apache-2.0 | **replayed** (partial) | `rtk pipe --filter <name>` on stdin |
| caveman engine | engine bin `bin-v1.1.8`, repo v2.7.0 | **BSL-1.1** | **replayed** | user's own `caveman-engine compress [--type <t>]` on stdin |
| headroom | v0.38.0 (2026-09-21) | Apache-2.0 | **replayed** | user's own `headroom-ai[ml]`, Python `headroom.compress(messages, model=…)` |
| caveman skill | repo v2.7.0 | MIT | **modeled** | output style only |
| fast-jev-compaction | no releases | MIT | **modeled** | range; decisions need the hosted Jev API |
| codegraph | v1.6.0 (2026-08-26) | MIT | **upper bound** | changes agent behaviour |
| context-mode | v1.0.169 (2026-06-29) | **Elastic-2.0** | **upper bound** | changes agent behaviour |

**rtk.** Confirmed:
- `rtk pipe --filter|-f <name>` reads stdin (10 MiB cap), filters and prints; no command runs and no network is used (`src/main.rs` L739-748, `src/cmds/system/pipe_cmd.rs` L256-289).
- Without `--filter` it auto-detects from the first 1 KB.
- Output passes through `never_worse()` (`src/core/guard.rs` L17), so a replay can never be worse than the input.
- Filter names are hard-coded in `resolve_filter()` (`pipe_cmd.rs` L12-41): cargo-test/cargo, pytest, go-test, go-build, ctest, tsc, vitest, grep/rg, find/fd, git-log, git-diff, git-status, log, mypy, ruff-check, ruff-format, sqlfluff-lint, prettier, phpunit, pest/paratest/php-test, ecs, phpstan, pint.
- The 63 TOML filters are **not** reachable from `pipe`.
- `rtk rewrite "<cmd>"` prints the rewritten command and exits 0 (allow), 3 (ask), 1 (no equivalent) or 2 (deny).
- The hook matcher is `Bash` only (`src/hooks/init.rs` L1716-1722); Codex also gets a Bash PreToolUse hook.
- **Format mismatch:** live rtk runs `git status --porcelain -b` and injects a `git log --pretty=format:…---END---` format (`src/cmds/git/git_cmd.rs` L84-92, L1812). The `git-status` and `git-log` pipe filters expect those formats and just copy recorded human-format output.
- Telemetry is opt-in.

**caveman.**
- The licence split in `LICENSING.md`:
  - MIT: `skills/`, `packages/cli/`, SDKs, `evals/`.
  - BSL-1.1: `engine/`, `proxy/`, `shrink/`, `mcp/`, `rewriter/`, `browse/`, `mem/`, `shared/platform/`. These convert to Apache-2.0 on 2030-06-21 or on a version's fourth anniversary.
- **Engine usage:** `caveman-engine compress [--type <content-type>]` reads stdin (64 MiB cap) and writes the result to stdout. It writes a JSON report with `TokensBefore`/`TokensAfter` to stderr. `engine/` imports no networking (`engine/cmd/caveman-engine/main.go`).
- **Side effect:** the engine creates `~/.caveman/ccr.db`. Run it with `CAVEMAN_HOME` (or `CAVEMAN_CCR_DB`) set to a temp dir.
- **Install and lookup:** installed with `npm i -g @caveman-ai/cli && caveman setup --install`. The binary is looked up via `CAVEMAN_ENGINE_BIN`, then PATH, then `~/.caveman/bin`.
- **Skill numbers:** `docs/HONEST-NUMBERS.md` now says the skill's output reduction is "Not published" and its input cost "Not measured here". The "~1–1.5k tokens per turn" line was removed on 2026-09-08, and the 65% output claim was withdrawn on 2026-08-16. `skills/caveman/SKILL.md` is 7,061 bytes.
- **Correction to §3:** the "adds about 1k input tokens" figure is no longer caveman's own. Model the overhead from the SKILL.md size (tokenized) and state that assumption. The output reduction to model is JetBrains' −8.5% (§3), the only independent figure.

**headroom.**
- **API:** Python `headroom.compress(messages, model=…, model_limit=200000, optimize=True)` returns `CompressResult` (`.messages`, `.tokens_saved`, `.compression_ratio`). It is in `headroom/compress.py` L171 and takes Anthropic- or OpenAI-format message lists. There is no "compress this text" CLI.
- **Kompress model:** `chopratejas/kompress-v2-base`, a ModernBERT fine-tune in ONNX, pinned to revision b1563631b35b. The default file is int8, about 261 MB. It needs the `[ml]` extra, and the ONNX Runtime may be fetched from `cdn.pyke.io` (unverified for prebuilt wheels).
- **Offline:** `HEADROOM_OFFLINE=1` sets `HF_HUB_OFFLINE` and `TRANSFORMERS_OFFLINE`.
- **Telemetry:** the anonymous beacon is **on by default**. Turn it off with `HEADROOM_BEACON=off`, `DO_NOT_TRACK=1` or `HEADROOM_OFFLINE=1`. saver-audit must set all three when it calls headroom.
- **Overlap to watch:** `headroom audit-reads` (`headroom/cli/audit.py`) already reads `~/.claude/projects` and `~/.codex/sessions`.
- **Correction to §3:** the model is a kompress-v2 fine-tune, not stock ModernBERT.

**codegraph.**
- **Mechanism:** confirmed. One MCP tool, `codegraph_explore`, over a local SQLite graph.
- **Its own measurement** (README L196-253): −62% tokens and −44% cost. Method: `claude -p`, Opus 4.8, 7 repos × 4 runs, median, re-measured 2026-08-05. The same README says residual context is about 80% higher.
- **Telemetry:** appears to be on by default (`CODEGRAPH_TELEMETRY=0` turns it off).
- **Class:** upper bound. Cite their A/B only as their claim.

**fast-jev-compaction.**
- **Hosted API confirmed:** `https://api.typesafe.ai/v1/systemone` (`src/request.ts` L3). It needs `TYPESAFE_API_KEY`.
- **Per decision:** for each non-pinned tool call, Jev chooses between:
  - keep the call and result;
  - truncate the result to the first 300 characters plus a note;
  - **drop the call and result entirely**.
- **Defaults:** `keepThreshold` 0.5. The first message and the last 6 messages are pinned (`src/compact.ts` L17-24).
- **Fallback:** falls back to built-in compaction if the estimated reduction is under 25% or on any failure.
- **Trigger:** triggers compaction itself at 60% of the context.
- **Correction to §0/§3:** "every old result cut to 300 chars" is not a ceiling. The model range is:
  - lower: built-in summary (no change when the reduction is under 25%);
  - middle: every non-pinned result cut to 300 characters;
  - upper: every non-pinned tool pair dropped.
- **Caveat:** the earlier 60% trigger changes when compaction happens, which offline replay does not reproduce. State this.

**context-mode.**
- **Licence and mechanism:** Elastic-2.0. Hooks plus 11 `ctx_*` MCP tools run work in a sandbox. SessionStart injects routing instructions.
- **Thresholds** (`src/server.ts` L1979-1980):
  - `INTENT_SEARCH_THRESHOLD = 5_000` **bytes**: above this, and only when the agent passes an `intent`, the output is indexed and only matches are returned.
  - `LARGE_OUTPUT_THRESHOLD = 102_400` bytes: above this, the output is always indexed and a pointer is returned.
- **Correction to §3:** the "over 5KB indexed" rule applies only when the agent passes an `intent`. For the upper bound, assume every tool output over 5,000 bytes shrinks to a small excerpt, and say so.

**Not verified:** whether headroom's library path ever sends the beacon; whether prebuilt headroom wheels still fetch ONNX Runtime; caveman CLI and codegraph telemetry defaults for users who skip the installers.
