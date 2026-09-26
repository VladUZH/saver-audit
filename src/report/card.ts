// --card: a 1200×675 PNG share card. It holds numbers, model names, dates and fixed
// labels only (CLAUDE.md non-negotiable 2): never prompts, paths, commands or project
// names. SVG is built here and rasterized offline with resvg (WASM) and a bundled font.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AuditResult } from "../audit.ts";
import { agentNames, confidence, fmtTokens, fmtUsd, loggedDays, measuredCost, onlyHypothetical, periodDays, plural, sessionCount, shortLabel, tooLittleData, unpricedCalls } from "./terminal.ts";

const W = 1200;
const H = 675;
const PAD = 56;
const ROW = 44;
const C = {
  bg: "#0f1115",
  panel: "#171a21",
  text: "#eceae6",
  muted: "#8d939c",
  faint: "#2a2f39",
  accent: "#f5a524",
  good: "#58c48a",
  bound: "#6aa2ff",
};


function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function text(x: number, y: number, s: string, size: number, fill: string, opts: { bold?: boolean; anchor?: "start" | "end" } = {}): string {
  return `<text x="${x}" y="${y}" font-family="JetBrains Mono" font-size="${size}"${opts.bold ? ' font-weight="700"' : ""}${opts.anchor === "end" ? ' text-anchor="end"' : ""} fill="${fill}">${esc(s)}</text>`;
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const METHOD: Record<string, string> = { replayed: "replayed", modeled: "modeled", "upper-bound": "ceiling" };

/**
 * `head` and as many `items` as fit in `max` characters (the font is monospaced), then
 * "+N more" for the rest. A first item too long on its own is cut with "…".
 */
export function fitList(head: string, items: string[], max: number): string {
  let line = head;
  for (let i = 0; i < items.length; i++) {
    const rest = items.length - i - 1;
    const more = rest ? ` · +${rest} more` : "";
    const next = `${line}${i ? " ·" : ""} ${items[i]}`;
    if ((next + more).length <= max) {
      line = next;
      continue;
    }
    // The previous step left room for "+N more".
    if (i) return `${line} · +${rest + 1} more`;
    return `${line} ${items[0]!.slice(0, Math.max(1, max - line.length - more.length - 2))}…${more}`;
  }
  return line;
}

/** Why the card has no saver row, and what would give one. */
function noSaverLines(r: AuditResult): [string, string?] {
  const replayed = r.savers.filter((s) => s.method === "replayed");
  if (!replayed.length) return ["No saver replayed in this run."];
  if (replayed.some((s) => s.status === "ok" && tooLittleData(s) && !s.replay?.failed)) return ["No saver measured yet.", "exact numbers: npx saver-audit --exact"];
  if (replayed.some((s) => s.status === "not installed")) return ["No saver measured yet.", "npx saver-audit --install-savers"];
  if (replayed.some((s) => s.status === "ok" && !tooLittleData(s))) return ["Only hypothetical savings, on Codex.", "Codex hooks cannot rewrite tool input."];
  return ["No saver measured: replays failed."];
}

export function cardSvg(r: AuditResult): string {
  const total = r.billing.total.cost;
  // Logs can cover less than the period (Claude Code keeps 30 days by default); say so.
  const days = loggedDays(r);
  const span = days < periodDays(r) ? `logs cover ${plural(days, "day")}` : plural(days, "day");
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

  // Header
  parts.push(text(PAD, 76, "saver-audit", 30, C.accent, { bold: true }));
  parts.push(text(W - PAD, 76, `${localDay(r.period.since)} → ${localDay(r.period.until)} · ${span}`, 20, C.muted, { anchor: "end" }));

  // Headline
  parts.push(text(PAD, 172, fmtUsd(total), 84, C.text, { bold: true }));
  parts.push(text(PAD, 208, `API-equivalent at list prices of ${r.prices.date}, prompt cache included`, 18, C.muted));
  const unpriced = unpricedCalls(r);
  if (unpriced) parts.push(text(PAD, 233, `excludes ${unpriced.toLocaleString("en-US")} ${unpriced === 1 ? "call" : "calls"} on unpriced models`, 15, C.accent));
  parts.push(text(W - PAD, 132, `${fmtTokens(r.billing.total.tokens)} tokens`, 26, C.text, { anchor: "end", bold: true }));
  parts.push(text(W - PAD, 166, `${plural(r.calls, "API call")} · ${sessionCount(r)}`, 18, C.muted, { anchor: "end" }));
  parts.push(text(W - PAD, 196, agentNames(r), 18, C.muted, { anchor: "end" }));

  // Left panel: where it went
  const top = 244;
  const panelH = 346;
  const leftW = 520;
  parts.push(`<rect x="${PAD - 16}" y="${top}" width="${leftW + 32}" height="${panelH}" rx="14" fill="${C.panel}"/>`);
  parts.push(text(PAD + 4, top + 40, "Where it went", 22, C.text, { bold: true }));
  const rows = r.buckets.filter((b) => b.cost > 0).slice(0, 6);
  rows.forEach((b, i) => {
    const y = top + 82 + i * ROW;
    const share = total ? b.cost / total : 0;
    const label = shortLabel(b.label);
    parts.push(text(PAD + 4, y, label, 17, C.text));
    parts.push(text(PAD + leftW - 4, y, `${Math.round(share * 100)}%`, 17, C.muted, { anchor: "end" }));
    parts.push(`<rect x="${PAD + 4}" y="${y + 9}" width="${leftW - 8}" height="6" rx="3" fill="${C.faint}"/>`);
    parts.push(`<rect x="${PAD + 4}" y="${y + 9}" width="${Math.max(3, (leftW - 8) * share)}" height="6" rx="3" fill="${C.accent}"/>`);
  });

  // Right panel: savers
  const rx = PAD + leftW + 48;
  const rightW = W - PAD - rx;
  parts.push(`<rect x="${rx - 16}" y="${top}" width="${rightW + 32}" height="${panelH}" rx="14" fill="${C.panel}"/>`);
  parts.push(text(rx + 4, top + 40, "What token savers would cut", 22, C.text, { bold: true }));
  // Measured savers only; the rest are one muted line (they are not measurements).
  // A hook saver's hypothetical Codex part is left out; a saver with nothing else is dropped.
  const savers = r.savers.filter((s) => s.status === "ok" && s.method === "replayed" && !tooLittleData(s) && !onlyHypothetical(s)).sort((a, b) => measuredCost(b) - measuredCost(a)).slice(0, 5);
  if (!savers.length) {
    const [why, hint] = noSaverLines(r);
    parts.push(text(rx + 4, top + 88, why, 17, C.muted));
    if (hint) parts.push(text(rx + 4, top + 114, hint, 15, C.muted));
  }
  const bounds = r.savers.filter((s) => s.status === "ok" && s.method === "upper-bound").sort((a, b) => b.cost - a.cost);
  if (bounds.length && total) {
    const items = bounds.map((s) => `${s.name} ≤ ${((100 * s.cost) / total).toFixed(0)}%`);
    parts.push(text(rx + 4, top + panelH - 22, fitList("best case, not measured:", items, Math.floor((rightW - 8) / (0.6 * 13))), 13, C.muted));
  }
  savers.forEach((s, i) => {
    const y = top + 82 + i * ROW;
    const le = s.method === "upper-bound" ? "≤ " : "";
    const cost = measuredCost(s);
    const pct = total ? (100 * cost) / total : 0;
    const val = `${cost < 0 ? "-" : le}${fmtUsd(Math.abs(cost))} · ${pct.toFixed(1)}%`;
    const color = s.method === "upper-bound" ? C.bound : cost < 0 ? C.muted : C.good;
    parts.push(text(rx + 4, y, s.name.replace(" (proxy engine)", " engine").replace(" (skill)", " skill"), 17, C.text));
    // The card travels without the report's notes, so a sampled number says so here.
    const conf = confidence(s);
    parts.push(text(rx + 4, y + 20, conf === "indicative" ? `${METHOD[s.method]} · indicative` : METHOD[s.method]!, 13, C.muted));
    parts.push(text(rx + rightW - 4, y, val, 17, color, { anchor: "end", bold: true }));
  });

  // Footer
  parts.push(text(PAD, H - 34, "npx saver-audit", 22, C.accent, { bold: true }));
  parts.push(text(W - PAD, H - 34, "measured offline on my own logs · not a bill", 16, C.muted, { anchor: "end" }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

/** Finds a bundled asset next to dist/cli.js, or in the repo when running from src/. */
function asset(distRel: string, repoRel: string): Uint8Array {
  for (const rel of [distRel, repoRel]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return readFileSync(p);
  }
  throw new Error(`--card: missing ${distRel}`);
}

let wasmReady: Promise<unknown> | undefined;

export async function writeCard(r: AuditResult, path: string): Promise<void> {
  const { Resvg, initWasm } = await import("@resvg/resvg-wasm");
  wasmReady ??= initWasm(asset("./resvg.wasm", "../../node_modules/@resvg/resvg-wasm/index_bg.wasm"));
  await wasmReady;
  const fontBuffers = [asset("./fonts/JetBrainsMono-Regular.ttf", "../../assets/fonts/JetBrainsMono-Regular.ttf"), asset("./fonts/JetBrainsMono-Bold.ttf", "../../assets/fonts/JetBrainsMono-Bold.ttf")];
  const resvg = new Resvg(cardSvg(r), { font: { fontBuffers, defaultFontFamily: "JetBrains Mono", loadSystemFonts: false } as never, fitTo: { mode: "original" } });
  const png = resvg.render();
  writeFileSync(path, png.asPng());
  png.free();
  resvg.free();
}
