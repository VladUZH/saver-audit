// Normalized model shared by all sources. Parsers stream these events; nothing
// downstream keeps text longer than it takes to count or transform it.

export type Source = "claude-code" | "codex";

export interface Session {
  source: Source;
  id: string;
  file: string;
  /** Basename of the working directory. Only shown with --show-projects. */
  project?: string;
  /** True for subagent / sidechain transcripts and Codex child threads. */
  isSubagent: boolean;
  started?: string;
}

export type Block =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; tool: string; id?: string; input: unknown }
  | {
      kind: "tool_result";
      tool: string;
      family: string;
      /** What the model saw. */
      text: string;
      id?: string;
      isError?: boolean;
      /** Shell command that produced it (shell tools only). */
      command?: string;
      /** Full output when `text` is a <persisted-output> preview (Claude Bash). */
      raw?: string;
    };

/**
 * Usage of one API call, normalized to Claude semantics: `input` is the uncached
 * remainder, so the full prompt is input + cacheWrite + cacheRead.
 */
export interface Usage {
  input: number;
  cacheWrite: number;
  /** Part of cacheWrite written with the 1-hour TTL (priced at 2x input). */
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  /** Part of output that was thinking/reasoning, when the log says so. */
  reasoning: number;
  webSearches: number;
}

export interface Call {
  /** Dedupe key: Claude message.id|requestId; Codex file#ordinal. */
  key: string;
  model: string;
  /** Mutable: a later duplicate line may raise these numbers (max per field). */
  usage: Usage;
  /** Price multiplier from fast mode / priority tier / data residency. */
  multiplier: number;
  /** False for history replayed into a forked Codex thread. */
  billable: boolean;
  /**
   * Codex hosted web searches (web_search_call items) logged before this call's usage.
   * Counted, not priced: the price list has no OpenAI per-search fee.
   */
  webSearchCalls?: number;
}

/** What a user-side turn contains, for bucketing. */
export type UserKind = "prompt" | "injected" | "tool-results" | "compaction-summary" | "system";

export interface Turn {
  index: number;
  role: "user" | "assistant";
  /** Context thread this turn belongs to (a file can hold sidechains). */
  timeline: string;
  timestamp?: string;
  blocks: Block[];
  userKind?: UserKind;
  /** Assistant turns only: the API call that produced it. */
  call?: Call;
  /** Assistant turns only: the response had thinking blocks (their text is not logged). */
  thinking?: boolean;
  /** User-side turns only: sent again with every request, so it outlives compaction (Codex base instructions). */
  resent?: boolean;
  /**
   * Prompts only: the prompt continues from an earlier point of the conversation (a
   * rewind or an edited prompt). Key of the last call it keeps; null keeps none.
   */
  rewind?: string | null;
}

export type SourceEvent =
  | { t: "session"; session: Session }
  | { t: "turn"; turn: Turn }
  | { t: "compact"; timeline: string }
  | { t: "skip"; reason: string };

export function emptyUsage(): Usage {
  return { input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, reasoning: 0, webSearches: 0 };
}

export function maxUsage(into: Usage, u: Usage): void {
  into.input = Math.max(into.input, u.input);
  into.cacheWrite = Math.max(into.cacheWrite, u.cacheWrite);
  into.cacheWrite1h = Math.max(into.cacheWrite1h, u.cacheWrite1h);
  into.cacheRead = Math.max(into.cacheRead, u.cacheRead);
  into.output = Math.max(into.output, u.output);
  into.reasoning = Math.max(into.reasoning, u.reasoning);
  into.webSearches = Math.max(into.webSearches, u.webSearches);
}

export function promptTokens(u: Usage): number {
  return u.input + u.cacheWrite + u.cacheRead;
}
