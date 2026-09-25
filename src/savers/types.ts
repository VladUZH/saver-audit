// Saver adapters. Every saver result carries one of three method labels
// (CLAUDE.md non-negotiable 3):
//   replayed     a deterministic transform applied to the recorded text
//   modeled      an estimate, with its assumption stated
//   upper-bound  the saver changes agent behaviour, so only a ceiling is given
import type { Source } from "../sources/types.ts";

export type Method = "replayed" | "modeled" | "upper-bound";

export interface SaverInfo {
  id: string;
  name: string;
  repo: string;
  /** Saver version this adapter was written against (tech-notes §8.5). */
  version: string;
  licence: string;
  method: Method;
  /** What part of the logs the saver can act on. */
  covers: string;
  /** The stated assumption for modeled and upper-bound results. */
  assumption?: string;
  /** Savers that act through Claude Code hooks cannot rewrite inputs on Codex. */
  codexHypothetical: boolean;
}

/** A tool output as the adapters see it. Text never leaves the process. */
export interface OutputView {
  source: Source;
  tool: string;
  category: string;
  family: string;
  /** Shell command, for shell tools only. */
  command?: string;
  /** What the model saw (Claude Code may have replaced large output by a preview). */
  text: string;
  /** Full raw output when the model saw a <persisted-output> preview (Claude Bash). */
  raw?: string;
  /** o200k tokens of `text`. */
  tokens: number;
}

/** A replay request for an external saver binary; resolved in the main thread. */
export interface ReplayJob {
  saver: string;
  /** Content hash: cache key for (saver, version, tool, input). */
  key: string;
  tool: string;
  /** Extra argument for the saver (rtk filter name, caveman content type). */
  arg?: string;
  /** Input text; empty when the result is already cached (text stays in the worker). */
  input: string;
  /** Class for extrapolating sampled results: `<category>|<family>`. */
  cls: string;
  /** Baseline tokens (what the model saw). */
  baseline: number;
  /**
   * When set, the model saw a <persisted-output> preview of a large output: the
   * saver's output is presented the same way if it is still over the inline limit.
   */
  persistedHeader?: string;
  /** o200k tokens of persistedHeader (0 when unset). */
  headerTokens: number;
  /** Tokens kept around the saver's output (Codex shell header). */
  addTokens: number;
  /** Where the result goes: timeline block index in the file. */
  timeline: string;
  block: number;
}
