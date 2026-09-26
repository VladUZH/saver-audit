// Codex rollouts: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl and
// archived_sessions/. Usage comes from repeated token_count events; cached tokens are
// a subset of input (tech-notes.md §2, §8.2).
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { listFiles, readLines } from "./files.ts";
import { emptyUsage, type Block, type Call, type Session, type SourceEvent, type UserKind, type Usage } from "./types.ts";
import { shellFamily } from "../accounting/categories.ts";

export function codexHome(): string {
  // An empty value counts as unset; a relative one is resolved so "Looked in" is unambiguous.
  const v = process.env.CODEX_HOME?.trim();
  return v ? resolve(v) : join(homedir(), ".codex");
}

export function findCodexFiles(home: string, sinceMs: number): string[] {
  const isRollout = (f: string) => /^rollout-.*\.jsonl$/.test(basename(f));
  const live = listFiles(join(home, "sessions"), sinceMs).filter(isRollout);
  const names = new Set(live.map((f) => basename(f)));
  // A rollout present in both places: the sessions/ copy wins.
  const archived = listFiles(join(home, "archived_sessions"), sinceMs).filter((f) => isRollout(f) && !names.has(basename(f)));
  return [...live, ...archived].sort();
}

const INJECTED = /^\s*(<environment_context|<user_instructions|<permissions|<INSTRUCTIONS|<turn_aborted|<user_shell_command|# AGENTS\.md|<skill|<subagent_notification)/;

export async function* parseCodexFile(file: string): AsyncGenerator<SourceEvent> {
  const tools = new Map<string, { tool: string; family: string; command?: string }>();
  let session: Session | undefined;
  let model = "";
  let multiplier = 1;
  // Forked and child threads open with the parent's history re-recorded as a dense
  // burst of token_count events stamped with the fork instant; that usage was billed
  // in the parent. Same rule as ccusage (rust/adapters/codex/src/parser.rs): if the
  // first two usage events are ≤1 s apart, skip the run of events ≤1 s apart. A first
  // event ≤1 s after session_meta is replayed too, even with no second one close by
  // (a parent with a single call).
  let replay: "none" | "first" | "second" | "burst" = "none";
  let forkMs = NaN;
  let firstCall: Call | undefined;
  let lastMs = 0;
  let prevTotal = -1;
  let index = 0;
  let lineNo = 0;

  for await (const line of readLines(file)) {
    lineNo++;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      yield { t: "skip", reason: "unparseable line" };
      continue;
    }
    const p = o?.payload;
    if (!p || typeof p !== "object") continue;
    const timestamp = typeof o.timestamp === "string" ? o.timestamp : undefined;

    switch (o.type) {
      case "session_meta": {
        if (session) break;
        const child = typeof p.parent_thread_id === "string" || typeof p.forked_from_id === "string";
        session = {
          source: "codex",
          id: typeof p.id === "string" ? p.id : basename(file, ".jsonl"),
          file,
          project: typeof p.cwd === "string" ? basename(p.cwd) : undefined,
          isSubagent: typeof p.parent_thread_id === "string",
          started: timestamp,
        };
        if (child) {
          replay = "first";
          forkMs = timestamp ? Date.parse(timestamp) : NaN;
        }
        yield { t: "session", session };
        const base = p.base_instructions?.text;
        if (typeof base === "string" && base) {
          yield { t: "turn", turn: { index: index++, role: "user", timeline: "main", timestamp, blocks: [{ kind: "text", text: base }], userKind: "system" } };
        }
        break;
      }
      case "turn_context":
        if (typeof p.model === "string") model = p.model;
        break;
      case "compacted": {
        yield { t: "compact", timeline: "main" };
        const texts: string[] = [];
        if (typeof p.message === "string" && p.message) texts.push(p.message);
        if (Array.isArray(p.replacement_history)) for (const item of p.replacement_history) texts.push(...contentTexts(item?.content));
        if (texts.length) {
          yield { t: "turn", turn: { index: index++, role: "user", timeline: "main", timestamp, blocks: texts.map((text) => ({ kind: "text", text })), userKind: "compaction-summary" } };
        }
        break;
      }
      case "event_msg":
        // A settings event without a service_tier key leaves the tier unchanged.
        if (p.type === "thread_settings_applied" && p.thread_settings && "service_tier" in p.thread_settings) multiplier = tierMultiplier(p.thread_settings.service_tier);
        else if (p.type === "token_count") {
          const info = p.info;
          if (!info || typeof info !== "object") break;
          const total = info.total_token_usage?.total_tokens;
          // Re-emitted events repeat the cumulative total; counting them inflates usage.
          if (typeof total === "number" && total === prevTotal) break;
          if (typeof total === "number") prevTotal = total;
          const usage = codexUsage(info.last_token_usage);
          if (usage.input + usage.cacheRead + usage.cacheWrite === 0 && usage.output === 0) break;
          const call: Call = { key: `${file}#${lineNo}`, model: model || "gpt-5", usage, multiplier, billable: true };
          const ms = timestamp ? Date.parse(timestamp) : NaN;
          const inBurst = Number.isFinite(ms) && ms - lastMs >= 0 && ms - lastMs <= BURST_GAP_MS;
          if (replay === "first") {
            if (!Number.isFinite(ms)) replay = "none";
            else if (ms - forkMs >= 0 && ms - forkMs <= BURST_GAP_MS) {
              call.billable = false;
              replay = "burst";
            } else {
              call.billable = false;
              firstCall = call;
              replay = "second";
            }
          } else if (replay === "second" || replay === "burst") {
            if (inBurst) call.billable = false;
            else {
              // A pause right after the first event: no replayed burst, bill it after all.
              if (replay === "second") firstCall!.billable = true;
              replay = "none";
            }
            if (replay === "second") replay = "burst";
          }
          lastMs = ms;
          yield { t: "turn", turn: { index: index++, role: "assistant", timeline: "main", timestamp, blocks: [], call } };
        }
        break;
      case "response_item": {
        const ev = responseItem(p, tools);
        if (ev) yield { t: "turn", turn: { index: index++, timeline: "main", timestamp, ...ev } };
        break;
      }
    }
  }
  // A fork with a single usage event had no burst.
  if (replay === "second") firstCall!.billable = true;
}

const BURST_GAP_MS = 1000;

type PartialTurn = { role: "user" | "assistant"; blocks: Block[]; userKind?: UserKind };

function responseItem(p: any, tools: Map<string, { tool: string; family: string; command?: string }>): PartialTurn | undefined {
  switch (p.type) {
    case "message": {
      const texts = contentTexts(p.content);
      if (!texts.length) return undefined;
      const blocks: Block[] = texts.map((text) => ({ kind: "text", text }));
      if (p.role === "assistant") return { role: "assistant", blocks };
      if (p.role === "developer" || p.role === "system") return { role: "user", blocks, userKind: "system" };
      return { role: "user", blocks, userKind: INJECTED.test(texts[0]!) ? "injected" : "prompt" };
    }
    case "function_call":
    case "custom_tool_call":
    case "local_shell_call": {
      const tool = p.type === "local_shell_call" ? "local_shell_call" : String(p.name ?? "unknown");
      const input = p.type === "function_call" ? parseJson(p.arguments) : p.type === "custom_tool_call" ? p.input : p.action;
      const cmd = shellCommand(tool, input);
      if (typeof p.call_id === "string") tools.set(p.call_id, { tool, family: cmd !== undefined ? shellFamily(cmd) : "", command: cmd || undefined });
      return { role: "assistant", blocks: [{ kind: "tool_use", tool, id: p.call_id, input }] };
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      const meta = tools.get(p.call_id) ?? { tool: "unknown", family: "" };
      const out = p.output;
      const text = typeof out === "string" ? out : Array.isArray(out) ? contentTexts(out).join("\n") : typeof out?.content === "string" ? out.content : "";
      return { role: "user", userKind: "tool-results", blocks: [{ kind: "tool_result", tool: meta.tool, family: meta.family, text, id: p.call_id, command: meta.command }] };
    }
    default:
      return undefined;
  }
}

function contentTexts(content: unknown): string[] {
  if (typeof content === "string") return content ? [content] : [];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const c of content) if (c && typeof c.text === "string" && c.text) out.push(c.text);
  return out;
}

function parseJson(s: unknown): unknown {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// A backslash only matches the escape branch; otherwise an unclosed string backtracks exponentially.
const EXEC_CMD = /exec_command\s*\(\s*\{[\s\S]*?["']?\bcmd["']?\s*:\s*(["'`])((?:\\[\s\S]|(?!\1|\\)[\s\S])*)\1/;

/** The shell command of a shell-type tool call, or undefined for other tools. */
export function shellCommand(tool: string, input: any): string | undefined {
  if (tool === "exec") {
    if (typeof input !== "string") return "";
    const m = EXEC_CMD.exec(input);
    return m ? m[2]! : "";
  }
  if (tool === "exec_command" || tool === "shell" || tool === "shell_command" || tool === "local_shell_call" || tool === "container.exec") {
    const c = input?.cmd ?? input?.command;
    if (Array.isArray(c)) return c.map(String).join(" ").replace(/^(bash|zsh|sh) -l?c /, "");
    return typeof c === "string" ? c : "";
  }
  return undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Converts OpenAI usage (cached ⊂ input) to Claude semantics (input = uncached). */
export function codexUsage(u: any): Usage {
  const usage = emptyUsage();
  if (!u || typeof u !== "object") return usage;
  const input = num(u.input_tokens);
  usage.cacheRead = Math.min(input, num(u.cached_input_tokens));
  // Assumption: cache writes are part of input and disjoint from cached reads.
  usage.cacheWrite = Math.min(input - usage.cacheRead, num(u.cache_write_input_tokens));
  usage.input = input - usage.cacheRead - usage.cacheWrite;
  usage.output = num(u.output_tokens);
  usage.reasoning = Math.min(usage.output, num(u.reasoning_output_tokens));
  return usage;
}

function tierMultiplier(tier: unknown): number {
  if (tier === "priority" || tier === "fast") return 2;
  if (tier === "flex") return 0.5;
  return 1;
}
