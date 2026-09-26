// Claude Code transcripts: ~/.claude/projects/<project>/<session>.jsonl plus
// <session>/subagents/**/agent-*.jsonl. The format is internal and changes between
// versions (tech-notes.md §1, §8.1): unknown record types are ignored, malformed
// lines are skipped and counted.
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { listFiles, readLines } from "./files.ts";
import { emptyUsage, maxUsage, type Block, type Call, type Session, type SourceEvent, type Turn, type Usage } from "./types.ts";
import { shellFamily } from "../accounting/categories.ts";

export function claudeRoots(): string[] {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return [join(base, "projects"), join(homedir(), ".config", "claude", "projects")];
}

export function findClaudeFiles(roots: string[], sinceMs: number): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const f of listFiles(root, sinceMs)) {
      // Set-aside copies of a transcript (.orphaned-…) would double count.
      if (f.endsWith(".jsonl") && !basename(f).includes(".orphaned-")) out.push(f);
    }
  }
  return out.sort();
}

/** A response still being written, and the user-side turns logged while it was. */
interface OpenCall { key: string; turn: Turn; held: Turn[] }
interface ToolMeta { tool: string; family: string; command?: string }

export async function* parseClaudeFile(file: string): AsyncGenerator<SourceEvent> {
  const isSubagentFile = file.includes(`${sep}subagents${sep}`);
  const tools = new Map<string, ToolMeta>();
  const calls = new Map<string, Call>();
  let session: Session | undefined;
  let index = 0;
  // One response is written as one line per content block, with a placeholder
  // output count on the early lines, and tool results or attachments can land between
  // those lines. They reach the model after the response, so they are held until it is
  // complete: a new response starts, the context is compacted or the file ends.
  const open = new Map<string, OpenCall>();

  function* flush(timeline: string): Generator<SourceEvent> {
    const cur = open.get(timeline);
    if (!cur) return;
    open.delete(timeline);
    yield { t: "turn", turn: cur.turn };
    for (const turn of cur.held) yield { t: "turn", turn };
  }

  function* user(turn: Turn): Generator<SourceEvent> {
    const cur = open.get(turn.timeline);
    if (cur) cur.held.push(turn);
    else yield { t: "turn", turn };
  }

  for await (const line of readLines(file)) {
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      yield { t: "skip", reason: "unparseable line" };
      continue;
    }
    if (!o || typeof o !== "object") continue;
    const type = o.type;
    if (type !== "assistant" && type !== "user" && type !== "system" && type !== "attachment") continue;

    if (!session) {
      session = {
        source: "claude-code",
        id: typeof o.sessionId === "string" ? o.sessionId : basename(file, ".jsonl"),
        file,
        project: typeof o.cwd === "string" ? basename(o.cwd) : undefined,
        isSubagent: isSubagentFile || o.isSidechain === true,
        started: typeof o.timestamp === "string" ? o.timestamp : undefined,
      };
      yield { t: "session", session };
    }
    const timeline = o.isSidechain === true && !isSubagentFile ? `side:${o.agentId ?? ""}` : "main";
    const timestamp = typeof o.timestamp === "string" ? o.timestamp : undefined;

    if (type === "attachment") {
      // Reminders, hook context and attached files are rendered into the next prompt
      // from this object. Its string values approximate that text.
      const text = NOT_IN_PROMPT.has(o.attachment?.type) ? "" : attachmentText(o.attachment);
      if (text) yield* user({ index: index++, role: "user", timeline, timestamp, blocks: [{ kind: "text", text }], userKind: "injected" });
      continue;
    }

    if (type === "system") {
      if (o.subtype === "compact_boundary") {
        yield* flush(timeline);
        yield { t: "compact", timeline };
      }
      continue;
    }

    const msg = o.message;
    if (!msg || typeof msg !== "object") continue;

    if (type === "assistant") {
      const model = typeof msg.model === "string" ? msg.model : "";
      if (model === "<synthetic>" || o.isApiErrorMessage === true) continue;
      const blocks = assistantBlocks(msg.content, tools);
      if (!msg.usage || typeof msg.id !== "string") continue;
      const key = `${msg.id}|${typeof o.requestId === "string" ? o.requestId : ""}`;
      const usage = claudeUsage(msg.usage);
      const cur = open.get(timeline);
      if (cur?.key === key) {
        cur.turn.blocks.push(...blocks);
        maxUsage(cur.turn.call!.usage, usage);
        continue;
      }
      const seen = calls.get(key);
      if (seen) {
        // Non-adjacent copy of an already emitted response: keep the max numbers.
        maxUsage(seen.usage, usage);
        continue;
      }
      yield* flush(timeline);
      const call: Call = { key, model, usage, multiplier: claudeMultiplier(msg.usage), billable: true };
      calls.set(key, call);
      open.set(timeline, { key, turn: { index: index++, role: "assistant", timeline, timestamp, blocks, call }, held: [] });
      continue;
    }

    // user
    const content = msg.content;
    const kind = o.isCompactSummary === true ? "compaction-summary" : o.isMeta === true ? "injected" : "prompt";
    const blocks: Block[] = [];
    if (typeof content === "string") {
      blocks.push({ kind: "text", text: content });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text" && typeof b.text === "string") blocks.push({ kind: "text", text: b.text });
        else if (b.type === "tool_result") {
          const meta = tools.get(b.tool_use_id) ?? { tool: "unknown", family: "" };
          const text = resultText(b.content);
          const raw = text.startsWith("<persisted-output>") ? rawOutput(o.toolUseResult) : undefined;
          blocks.push({ kind: "tool_result", tool: meta.tool, family: meta.family, text, id: b.tool_use_id, isError: b.is_error === true, command: meta.command, raw });
        }
      }
    }
    if (blocks.length === 0) continue;
    const userKind = blocks.every((b) => b.kind === "tool_result") ? "tool-results" : kind === "prompt" && isInjectedText(blocks) ? "injected" : kind;
    yield* user({ index: index++, role: "user", timeline, timestamp, blocks, userKind });
  }
  for (const timeline of [...open.keys()]) yield* flush(timeline);
}

/** Full Bash output from the structured result, when Claude Code kept it. */
function rawOutput(r: any): string | undefined {
  if (!r || typeof r !== "object" || typeof r.stdout !== "string") return undefined;
  const err = typeof r.stderr === "string" && r.stderr ? `\n${r.stderr}` : "";
  return r.stdout + err;
}

function assistantBlocks(content: unknown, tools: Map<string, ToolMeta>): Block[] {
  const out: Block[] = [];
  if (!Array.isArray(content)) return out;
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") out.push({ kind: "text", text: b.text });
    else if (b.type === "tool_use" && typeof b.name === "string") {
      const cmd = b.name === "Bash" && typeof b.input?.command === "string" ? b.input.command : undefined;
      if (typeof b.id === "string") tools.set(b.id, { tool: b.name, family: cmd ? shellFamily(cmd) : "", command: cmd });
      out.push({ kind: "tool_use", tool: b.name, id: b.id, input: b.input });
    }
  }
  return out;
}

/** The text the model saw for a tool result (images are not counted). */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let s = "";
  for (const c of content) if (c && c.type === "text" && typeof c.text === "string") s += (s ? "\n" : "") + c.text;
  return s;
}

// Attachment types assumed NOT to reach the model as new text (tech-notes §8.6):
// a snapshot of the system prompt (already in the residual), hook stdout, and a
// subagent's structured output (already counted as its tool result).
const NOT_IN_PROMPT = new Set(["prompt_snapshot", "hook_success", "structured_output"]);

const ATTACHMENT_META = /^(type|uuid|id|.*Id|.*Ids|.*Hash(es)?|hash|filename|displayPath|filePath|path|timestamp|durationMs|commit|hookEvent|hookName|exitCode)$/;

/** Concatenated string values of an attachment object, skipping metadata keys. */
export function attachmentText(a: unknown, depth = 0): string {
  if (typeof a === "string") return a;
  if (!a || typeof a !== "object" || depth > 5) return "";
  const parts: string[] = [];
  if (Array.isArray(a)) {
    for (const x of a) {
      const t = attachmentText(x, depth + 1);
      if (t) parts.push(t);
    }
  } else {
    for (const [k, v] of Object.entries(a)) {
      if (ATTACHMENT_META.test(k)) continue;
      const t = attachmentText(v, depth + 1);
      if (t) parts.push(t);
    }
  }
  return parts.join("\n");
}

function isInjectedText(blocks: Block[]): boolean {
  const first = blocks[0];
  if (!first || first.kind !== "text") return false;
  return /^\s*<(command-name|command-message|local-command-stdout|local-command-caveat|system-reminder|task-notification|bash-input|bash-stdout)/.test(first.text);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

export function claudeUsage(u: any): Usage {
  const usage = emptyUsage();
  usage.input = num(u.input_tokens);
  usage.cacheWrite = num(u.cache_creation_input_tokens);
  usage.cacheWrite1h = Math.min(usage.cacheWrite, num(u.cache_creation?.ephemeral_1h_input_tokens));
  usage.cacheRead = num(u.cache_read_input_tokens);
  usage.output = num(u.output_tokens);
  usage.reasoning = Math.min(usage.output, num(u.output_tokens_details?.thinking_tokens));
  usage.webSearches = num(u.server_tool_use?.web_search_requests);
  return usage;
}

function claudeMultiplier(u: any): number {
  let m = 1;
  if (u.speed === "fast") m *= 2; // fast mode lists at 2x (tech-notes §5.1)
  if (u.inference_geo === "us") m *= 1.1;
  return m;
}
