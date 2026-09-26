// Sharing on X from the terminal. X's post intent can pre-fill text and a link but
// cannot attach an image, so the card is put on the clipboard and the user pastes it
// into the composer. Nothing is uploaded by saver-audit; the browser opens x.com only
// when the user presses the share key. The post text holds numbers only.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { AuditResult } from "../audit.ts";
import { agentNames, isIndicative, loggedDays, measuredCost, onlyHypothetical, plural, tooLittleData, unpricedCalls } from "./terminal.ts";

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
  // Calls on unpriced models are not in the total, so it is a lower bound.
  const spend = `${unpricedCalls(r) ? "at least " : ""}${usd(total)}`;

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

/** Opens a URL or file with the OS default handler. Returns false if that failed. */
export function openExternal(target: string, reveal = false): boolean {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", reveal ? ["-R", target] : [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Copies a PNG to the clipboard as an image. Best effort; returns false if unsupported. */
export function copyImage(path: string): boolean {
  const run = (cmd: string, args: string[], input?: Buffer) => {
    try {
      const r = spawnSync(cmd, args, { input, stdio: [input ? "pipe" : "ignore", "ignore", "ignore"], timeout: 10_000 });
      return r.status === 0;
    } catch {
      return false;
    }
  };
  if (process.platform === "darwin") {
    return run("osascript", ["-e", `set the clipboard to (read (POSIX file ${JSON.stringify(path)}) as «class PNGf»)`]);
  }
  if (process.platform === "win32") {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile(${JSON.stringify(path)}))`;
    return run("powershell", ["-NoProfile", "-STA", "-Command", ps]);
  }
  const data = readFileSync(path);
  return run("wl-copy", ["--type", "image/png"], data) || run("xclip", ["-selection", "clipboard", "-t", "image/png", "-i"], data);
}
