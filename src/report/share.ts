// Sharing on X from the terminal. X's post intent can pre-fill text and a link but
// cannot attach an image, so the card is put on the clipboard and the user pastes it
// into the composer. Nothing is uploaded by saver-audit; the browser opens x.com only
// when the user presses the share key. The post text holds numbers only.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";
import type { AuditResult } from "../audit.ts";
import { agentNames, isIndicative, loggedDays, measuredCost, onlyHypothetical, plural, tooLittleData, totalIsLowerBound } from "./terminal.ts";

export const REPO_URL = "https://github.com/VladUZH/saver-audit";

function usd(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

// X's weighted length (twitter-text config v3): a link counts 23, code points in these
// ranges 1, every other one 2 (so "−" and "≈" count 2); at most 280.
const LINK = 23;
const LIMIT = 280;
const LIGHT: Array<[number, number]> = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];

function weight(ch: string): number {
  const cp = ch.codePointAt(0)!;
  return LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
}

/** A text's length as X counts it. */
export function xLength(text: string): number {
  // Split keeps each link at an odd index.
  return text
    .normalize("NFC")
    .split(/(https?:\/\/\S+)/)
    .reduce((n, part, i) => n + (i % 2 ? LINK : [...part].reduce((m, ch) => m + weight(ch), 0)), 0);
}

/** The longest start of `text` whose X length is at most `max`. */
function fit(text: string, max: number): string {
  let n = 0;
  let out = "";
  for (const ch of text.normalize("NFC")) {
    n += weight(ch);
    if (n > max) break;
    out += ch;
  }
  return out;
}

const short = (name: string) => name.replace(" (proxy engine)", " engine").replace(" (skill)", " skill");

/**
 * The pre-filled post, savings first: what each measured saver would cut on the
 * user's own sessions, with the total they were measured against. Modeled numbers are
 * left out (they barely differ between people); a best case is labelled as such.
 * Numbers, saver names and agent names only.
 */
export function shareText(r: AuditResult): string {
  const total = r.billing.total.cost;
  const days = plural(loggedDays(r), "day"); // the span the logs cover, not the requested period
  const agents = agentNames(r);
  const pct = (x: number) => `${((100 * x) / total).toFixed(1)}%`;
  const ok = r.savers.filter((s) => s.status === "ok" && total > 0);
  // A hook saver's hypothetical Codex part is left out; a saver with nothing else is dropped.
  const measured = ok.filter((s) => s.method === "replayed" && !tooLittleData(s) && !onlyHypothetical(s)).sort((a, b) => measuredCost(b) - measuredCost(a));
  const ceiling = ok.filter((s) => s.method === "upper-bound").sort((a, b) => b.cost - a.cost)[0];
  const cut = (s: (typeof ok)[number]) => {
    const c = measuredCost(s);
    return c >= 0 ? `−${pct(c)} (${usd(c)})` : `+${pct(-c)} (costs ${usd(-c)})`;
  };
  // Calls on unpriced models and Codex web search fees are not in the total, so it is a lower bound.
  const spend = `${totalIsLowerBound(r) ? "at least " : ""}${usd(total)}`;

  const best = ceiling ? `Best case (changes how the agent works): at most −${pct(ceiling.cost)} (${ceiling.name}).` : "";
  const tail = ["", measured.length ? "What would they cut for you? npx saver-audit" : "What would savers cut for you? npx saver-audit"];
  // Candidates in priority order; the first that fits a post (with the link) wins.
  const candidates: string[][] = [];
  if (measured.length) {
    const longHead = `I replayed ${days} of my ${agents} sessions through popular token savers:`;
    const shortHead = `Token savers on my ${agents} sessions:`;
    // "≈" marks numbers not fully measured (a quick sample, or failed replays).
    const approx = (s: (typeof ok)[number]) => (isIndicative(s) ? "≈" : "");
    const lines = measured.map((s) => `${short(s.name)} ${approx(s)}${cut(s)}`);
    const totalLine = `of ${spend} API-equivalent spend.`;
    // Compact form: every measured saver with its % only, before falling back to the top 3.
    const compact = measured.map((s) => `${short(s.name)} ${approx(s)}${measuredCost(s) >= 0 ? "−" : "+"}${pct(Math.abs(measuredCost(s)))}`);
    candidates.push(
      [longHead, ...lines, totalLine, best],
      [longHead, ...lines, totalLine],
      [shortHead, ...lines, totalLine],
      [`${shortHead.replace(/:$/, "")} (of ${spend} API-equivalent spend):`, ...compact],
      [shortHead, ...lines.slice(0, 3), totalLine],
    );
  } else {
    const head = `My AI coding agents (${agents}) used ${spend} of API-equivalent tokens in ${days}.`;
    candidates.push([head, best], [head]);
  }
  // The link goes after the text, one character apart.
  for (const c of candidates) {
    const text = [...c.filter(Boolean), ...tail].join("\n");
    if (xLength(text) + 1 + LINK <= LIMIT) return text;
  }
  return fit([...candidates[candidates.length - 1]!.filter(Boolean), ...tail].join("\n"), LIMIT - 1 - LINK);
}

export function intentUrl(text: string, url = REPO_URL): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/** A Windows system program by full path: a bare name is looked up in the current folder first. */
function system32(env: NodeJS.ProcessEnv, ...path: string[]): string {
  return win32.join(env.SystemRoot ?? "C:\\Windows", "System32", ...path);
}

/** The command that opens `target` with the OS default handler (`reveal`: show it in Finder). */
export function openCommand(target: string, reveal = false, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): { cmd: string; args: string[]; verbatim?: boolean } {
  if (platform === "darwin") return { cmd: "open", args: reveal ? ["-R", target] : [target] };
  // The target in quotes, passed as written: unquoted, cmd.exe takes the "&" in a URL
  // as the end of the command. A URL (percent-encoded) or a path holds no quote.
  if (platform === "win32") return { cmd: system32(env, "cmd.exe"), args: ["/d", "/s", "/c", `start "" "${target}"`], verbatim: true };
  return { cmd: "xdg-open", args: [target] };
}

/**
 * Opens a URL or file with the OS default handler. Resolves false when the opener is
 * missing or fails (xdg-open without a display); an opener still running after a few
 * seconds (waiting on the browser it started) counts as opened.
 */
export function openExternal(target: string, reveal = false): Promise<boolean> {
  const { cmd, args, verbatim } = openCommand(target, reveal);
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsVerbatimArguments: verbatim });
    } catch {
      return resolve(false);
    }
    const timer = setTimeout(() => resolve(true), 3000);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    child.on("error", () => done(false));
    child.on("exit", (code) => done(code === 0));
    child.unref();
  });
}

/**
 * Windows: PowerShell (by full path) puts the PNG on the clipboard. The path reaches it
 * in the environment, never in the script, where "$(…)" in a folder name would run.
 */
export function windowsClipboard(path: string, env: NodeJS.ProcessEnv = process.env): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const ps = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile($env:SAVER_AUDIT_CARD))";
  return { cmd: system32(env, "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoProfile", "-STA", "-Command", ps], env: { ...env, SAVER_AUDIT_CARD: path } };
}

/** Copies a PNG to the clipboard as an image. Best effort; returns false if unsupported. */
export function copyImage(path: string): boolean {
  const run = (cmd: string, args: string[], input?: Buffer, env?: NodeJS.ProcessEnv) => {
    try {
      const r = spawnSync(cmd, args, { input, env, stdio: [input ? "pipe" : "ignore", "ignore", "ignore"], timeout: 10_000 });
      return r.status === 0;
    } catch {
      return false;
    }
  };
  if (process.platform === "darwin") {
    return run("osascript", ["-e", `set the clipboard to (read (POSIX file ${JSON.stringify(path)}) as «class PNGf»)`]);
  }
  if (process.platform === "win32") {
    const w = windowsClipboard(path);
    return run(w.cmd, w.args, undefined, w.env);
  }
  const data = readFileSync(path);
  return run("wl-copy", ["--type", "image/png"], data) || run("xclip", ["-selection", "clipboard", "-t", "image/png", "-i"], data);
}
