// Sharing on X from the terminal. X's post intent can pre-fill text and a link but
// cannot attach an image, so the card is put on the clipboard and the user pastes it
// into the composer. Nothing is uploaded by saver-audit; the browser opens x.com only
// when the user presses the share key. The post text holds numbers only.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { AuditResult } from "../audit.ts";

export const REPO_URL = "https://github.com/VladUZH/saver-audit";

function usd(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

const LINK = 23; // X counts every link as 23 characters
const LIMIT = 280;

const short = (name: string) => name.replace(" (proxy engine)", " engine").replace(" (skill)", " skill");

/**
 * The pre-filled post, savings first: what each measured saver would cut on the
 * user's own sessions, with the total they were measured against. Modeled numbers are
 * left out (they barely differ between people); a best case is labelled as such.
 * Numbers, saver names and agent names only.
 */
export function shareText(r: AuditResult): string {
  const total = r.billing.total.cost;
  const days = Math.max(1, Math.round((Date.parse(r.period.until) - Date.parse(r.period.since)) / 864e5));
  const agents = Object.keys(r.sessions.bySource).map((s) => (s === "claude-code" ? "Claude Code" : "Codex")).join(" + ");
  const pct = (x: number) => `${((100 * x) / total).toFixed(1)}%`;
  const ok = r.savers.filter((s) => s.status === "ok" && total > 0);
  const measured = ok.filter((s) => s.method === "replayed").sort((a, b) => b.cost - a.cost);
  const ceiling = ok.filter((s) => s.method === "upper-bound").sort((a, b) => b.cost - a.cost)[0];
  const cut = (s: (typeof ok)[number]) => (s.cost >= 0 ? `−${pct(s.cost)} (${usd(s.cost)})` : `+${pct(-s.cost)} (costs ${usd(-s.cost)})`);

  const best = ceiling ? `Best case (changes how the agent works): at most −${pct(ceiling.cost)} (${ceiling.name}).` : "";
  const tail = ["", measured.length ? "What would they cut for you? npx saver-audit" : "What would savers cut for you? npx saver-audit"];
  // Candidates in priority order; the first that fits a post (with the link) wins.
  const candidates: string[][] = [];
  if (measured.length) {
    const longHead = `I replayed ${days} days of my ${agents} sessions through popular token savers:`;
    const shortHead = `Token savers on my ${agents} sessions:`;
    const lines = measured.map((s) => `${short(s.name)} ${cut(s)}`);
    const totalLine = `of ${usd(total)} API-equivalent spend.`;
    candidates.push([longHead, ...lines, totalLine, best], [longHead, ...lines, totalLine], [shortHead, ...lines.slice(0, 3), totalLine]);
  } else {
    const head = `My AI coding agents (${agents}) used ${usd(total)} of API-equivalent tokens in ${days} days.`;
    candidates.push([head, best], [head]);
  }
  for (const c of candidates) {
    const text = [...c.filter(Boolean), ...tail].join("\n");
    if (text.length + 1 + LINK <= LIMIT) return text;
  }
  return [...candidates[candidates.length - 1]!.filter(Boolean), ...tail].join("\n").slice(0, LIMIT - 1 - LINK);
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
