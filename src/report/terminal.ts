// The human report. Prints numbers, fixed labels and model names only: never prompts,
// paths, commands or tool output. Project names only with --show-projects.
import type { AuditResult } from "../audit.ts";
import { viaAlias } from "../prices/table.ts";
import type { InstallOffer } from "../savers/toolsdir.ts";

export interface TerminalOptions {
  showProjects: boolean;
  color: boolean;
  verbose: boolean;
  elapsedMs?: number;
  /** Where the share card was written, if it was. */
  cardPath?: string;
  /** A key menu follows the short view, so it may name the keys menuKeys() offers. */
  menu?: boolean;
  /** What the installer can do for the missing savers; undefined: not looked at. */
  install?: InstallOffer;
}

/** Replayed savers with outputs not measured yet: what [e] and --exact replay. */
export function exactPending(r: AuditResult): boolean {
  return r.savers.some((s) => s.status === "ok" && (s.replay?.pending ?? 0) > 0);
}

/**
 * The keys the menu offers besides [f], [s] and [o]. The short view names a key only
 * when this offers it, so the text and the menu never disagree.
 */
export function menuKeys(r: AuditResult, o: Pick<TerminalOptions, "menu" | "install">): { exact: boolean; install: boolean } {
  return { exact: !!o.menu && exactPending(r), install: !!o.menu && !!o.install?.ids.length };
}

const SHORT: Record<string, string> = {
  "Earlier assistant turns, re-read": "Earlier turns, re-read",
  "Not in logs: system prompt, tool definitions": "System prompt & tool defs",
  "Reminders, attachments & command output": "Reminders & attachments",
  "Assistant output (incl. thinking)": "Output incl. thinking",
  "Recorded system prompt & instructions": "Instructions (Codex)",
};

/** Compact bucket label, shared by the short view and the share card. */
export function shortLabel(label: string): string {
  return SHORT[label] ?? label.replace(/^Tool output: /, "Tool: ");
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The default view: one screen with the headline, where it went, the saver table and
 * the card. The full report (renderTerminal) is one key press away.
 */
export function renderShort(r: AuditResult, o: TerminalOptions): string {
  if (r.calls === 0) return renderTerminal(r, o);
  const bold = (s: string) => (o.color ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s: string) => (o.color ? `\x1b[2m${s}\x1b[0m` : s);
  const accent = (s: string) => (o.color ? `\x1b[33m${s}\x1b[0m` : s);
  const total = r.billing.total.cost;
  const pct = (x: number) => (total ? `${Math.round((100 * x) / total)}%` : "—");
  const out: string[] = [];
  out.push(bold(`saver-audit · ${localDay(r.period.since)} → ${localDay(r.period.until)} · ${agentNames(r)}`));
  const took = o.elapsedMs !== undefined ? ` · ${r.files.toLocaleString("en-US")} log files in ${(o.elapsedMs / 1000).toFixed(1)} s, nothing left your machine` : "";
  out.push(dim(`${sessionCount(r)} · ${plural(r.calls, "API call")}${took}`));
  out.push("");
  out.push(`${bold(accent(fmtUsd(total)))} ${bold("API-equivalent at list prices")} · ${fmtTokens(r.billing.total.tokens)} tokens`);
  const unpriced = unpricedCalls(r);
  if (unpriced) out.push(accent(`Excludes ${plural(unpriced, "call")} on unpriced models: ${[...new Set(r.models.filter((m) => !m.pricedAs).map((m) => m.model))].join(", ")} (tokens counted, $0).`));
  if (r.billing.webSearch.unpriced) out.push(accent(`Excludes the fees for ${codexSearches(r.billing.webSearch.unpriced)}: the price list has no OpenAI per-search fee.`));
  out.push(dim(`Not your bill: on a subscription you pay the plan price. List prices of ${r.prices.date}.`));
  out.push("");

  out.push(bold("Where it went"));
  const top = r.buckets.filter((b) => b.cost > 0).slice(0, 5);
  const shown = top.reduce((n, b) => n + b.cost, 0);
  for (const b of top) {
    const bar = "█".repeat(Math.max(1, Math.round((b.cost / total) * 20)));
    out.push(`  ${pad(shortLabel(b.label), 28)} ${lpad(fmtUsd(b.cost), 8)} ${lpad(pct(b.cost), 4)}  ${accent(bar)}`);
  }
  if (total - shown > 0.005) out.push(dim(`  ${pad("Everything else", 28)} ${lpad(fmtUsd(total - shown), 8)} ${lpad(pct(total - shown), 4)}`));
  out.push("");

  if (r.savers.length) {
    out.push(bold("What token savers would cut") + dim("  (on these sessions)"));
    // Only measured savers get a row: they are the numbers that differ person to person.
    // A hook saver's hypothetical Codex part is left out here, and named below.
    const measured = r.savers.filter((y) => y.status === "ok" && y.method === "replayed" && !tooLittleData(y)).sort((a, b) => measuredCost(b) - measuredCost(a));
    for (const x of measured) {
      const share = total ? `${((100 * measuredCost(x)) / total).toFixed(1)}%` : "—";
      out.push(`  ${pad(x.name.replace(" (proxy engine)", " engine"), 18)} ${lpad(signedUsd(measuredCost(x)), 9)} ${lpad(share, 7)}  ${dim(confidence(x))}`);
    }
    const keys = menuKeys(r, o);
    const later = r.savers.filter((y) => y.status === "ok" && tooLittleData(y));
    for (const x of later) out.push(`  ${pad(x.name.replace(" (proxy engine)", " engine"), 18)} ${lpad("—", 9)} ${lpad("", 7)}  ${dim(noNumber(x, keys.exact ? "press [e]" : "--exact"))}`);
    // Nothing measured: every replayed saver here is missing, or --savers picked none.
    if (!measured.length && !later.length) out.push(dim(r.savers.some((y) => y.method === "replayed") ? "  None measured yet: none of the replayed savers in this run is installed." : "  None measured: none of the selected savers is replayed (--savers)."));
    const exact = keys.exact ? `${bold("Press [e]")} for exact numbers (once; cached).` : "For exact numbers (once; cached): npx saver-audit --exact";
    if (measured.some((x) => x.replay?.extrapolated) || later.some((x) => !x.replay?.failedOut)) out.push(dim(`  "indicative" = from a quick sample; can be off by half. ${exact}`));
    if (measured.some((x) => x.replay?.failed)) out.push(dim(`  Some replays failed and count as unchanged, so those numbers are "indicative"; the full report has the counts.`));
    const hypo = measured.filter(hypotheticalCodex);
    if (hypo.length) out.push(dim(`  The Codex part is left out above (${hypo.map((x) => `${x.name.replace(" (proxy engine)", " engine")} about ${signedUsd(x.codexCost)}`).join(", ")}): it is hypothetical, since Codex hooks cannot rewrite tool input.`));
    const rest = unmeasuredLine(r);
    if (rest) out.push(dim(`  Not measurable offline: ${rest}.`));
    const missing = r.savers.filter((y) => y.status === "not installed");
    const quick = missing.filter((y) => y.id !== "headroom");
    // [i] is promised only for what the installer can do here; the others say why not.
    const offered = new Set(o.install?.ids ?? quick.map((y) => y.id));
    const can = quick.filter((y) => offered.has(y.id));
    const cannot = quick.filter((y) => !offered.has(y.id));
    const name = (y: Saver) => y.name.replace(" (proxy engine)", " engine");
    const them = can.length === 1 ? "it" : "them";
    if (can.length) out.push(`  ${accent("Not installed:")} ${can.map(name).join(", ")}. ${keys.install ? `${bold("Press [i]")} to install and measure ${them}.` : `To install and measure ${them}: npx saver-audit --install-savers`}`);
    const why = (y: Saver) => o.install?.why.get(y.id) ?? y.install;
    if (cannot.length) out.push(`  ${accent(can.length ? "Also not installed:" : "Not installed:")} ${cannot.map((y) => (why(y) ? `${name(y)} (${why(y)})` : name(y))).join(", ")}.`);
    if (missing.some((y) => y.id === "headroom")) out.push(dim("  headroom is a 1.6 GB install; add it with: npx saver-audit --install-savers --with-headroom"));
    out.push(dim("  These numbers replay your past sessions as they happened. A saver can also change"));
    out.push(dim("  how the agent works (e.g. extra steps to get cut output back); that isn't measured."));
    out.push("");
  }
  if (o.cardPath) out.push(`Share card: ${bold(o.cardPath)}`);
  return out.join("\n") + "\n";
}

type Saver = AuditResult["savers"][number];

/** Days in the requested period. */
export function periodDays(r: AuditResult): number {
  return Math.max(1, Math.round((Date.parse(r.period.until) - Date.parse(r.period.since)) / 864e5));
}

/** Calendar days (local) from the first counted call to the last, at most the period's days. */
export function loggedDays(r: AuditResult): number {
  if (!r.covered) return periodDays(r);
  const day = (iso: string) => {
    const d = new Date(iso);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.min(periodDays(r), Math.round((day(r.covered.last) - day(r.covered.first)) / 864e5) + 1);
}

/** "1 call", "2 calls". */
export function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** The agents behind the counted calls, subagent runs included: "Claude Code + Codex". */
export function agentNames(r: AuditResult): string {
  const list = r.sessions.sources.length ? r.sessions.sources : r.sources;
  return list.map((s) => (s === "claude-code" ? "Claude Code" : "Codex")).join(" + ");
}

/** "N sessions", or "N subagent runs" when only subagents made calls in the period. */
export function sessionCount(r: AuditResult): string {
  return r.sessions.main || !r.sessions.subagent ? plural(r.sessions.main, "session") : plural(r.sessions.subagent, "subagent run");
}

/** A saver's number without a hypothetical Codex part (Codex hooks cannot rewrite tool input). */
export function measuredCost(s: Saver): number {
  return s.codexHypothetical ? s.cost - s.codexCost : s.cost;
}

/** Whether a saver's number has a hypothetical Codex part worth naming. */
export function hypotheticalCodex(s: Saver): boolean {
  return s.codexHypothetical && Math.abs(s.codexCost) >= 0.005;
}

/** A saver whose whole number is a hypothetical Codex part: nothing of it was measured. */
export function onlyHypothetical(s: Saver): boolean {
  return s.codexHypothetical && s.codexCost !== 0 && s.cost === s.codexCost;
}

function signedUsd(n: number): string {
  return n < 0 ? `-${fmtUsd(-n)}` : fmtUsd(n);
}

/** Calls on models without a price: their tokens are counted, their dollars are not in the total. */
export function unpricedCalls(r: AuditResult): number {
  return r.models.reduce((n, m) => n + (m.pricedAs ? 0 : m.calls), 0);
}

/** "1 Codex web search", "3 Codex web searches": hosted searches whose fees are not in the total. */
export function codexSearches(n: number): string {
  return `${n.toLocaleString("en-US")} Codex web search${n === 1 ? "" : "es"}`;
}

/** The total leaves out known costs (calls on unpriced models, Codex web search fees), so it is a lower bound. */
export function totalIsLowerBound(r: AuditResult): boolean {
  return unpricedCalls(r) > 0 || r.billing.webSearch.unpriced > 0;
}

const BAR = 24;

export function fmtUsd(n: number): string {
  if (n >= 100) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function bar(share: number): string {
  const n = Math.max(0, Math.min(BAR, Math.round(share * BAR)));
  return "█".repeat(n) + "░".repeat(BAR - n);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function lpad(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

export function renderTerminal(r: AuditResult, o: TerminalOptions): string {
  const bold = (s: string) => (o.color ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s: string) => (o.color ? `\x1b[2m${s}\x1b[0m` : s);
  const out: string[] = [];
  const day = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // 1. Header
  out.push(bold(`saver-audit: ${day(r.period.since)} → ${day(r.period.until)}`));
  if (r.calls === 0) {
    out.push("", "No agent API calls found in this period. Looked in:");
    for (const p of r.looked) out.push(`  ${p}`);
    return out.join("\n") + "\n";
  }
  const bySource = Object.entries(r.sessions.bySource).map(([s, n]) => `${n} ${s}`).join(", ");
  out.push(`${r.sessions.main} sessions${bySource ? ` (${bySource})` : ""} + ${r.sessions.subagent} subagent runs, ${r.calls.toLocaleString("en-US")} API calls, ${r.projects.length} projects`);
  out.push(`Models: ${[...new Set(r.models.map((m) => m.model))].join(", ")}`);
  out.push("");
  out.push(bold(`Total: ${fmtUsd(r.billing.total.cost)} API-equivalent at list prices`) + ` · ${fmtTokens(r.billing.total.tokens)} tokens`);
  out.push(dim("Not your bill: on a Claude or ChatGPT subscription you pay the plan price. This is what the same tokens cost via the API."));
  out.push("");

  // 2. Where your tokens go
  out.push(bold("Where your tokens go (billed)"));
  const b = r.billing;
  const billRows: Array<[string, number, number]> = [
    ["Cache reads", b.cacheRead.tokens, b.cacheRead.cost],
    ["Cache writes", b.cacheWrite.tokens, b.cacheWrite.cost],
    ["Uncached input", b.input.tokens, b.input.cost],
    ["Output (incl. thinking)", b.output.tokens, b.output.cost],
  ];
  if (b.webSearch.requests) billRows.push([`Web searches (${b.webSearch.requests})`, 0, b.webSearch.cost]);
  for (const [label, tokens, cost] of billRows) {
    out.push(`  ${pad(label, 26)} ${lpad(tokens ? fmtTokens(tokens) : "", 8)}  ${lpad(fmtUsd(cost), 9)}  ${bar(cost / b.total.cost)}`);
  }
  if (b.webSearch.unpriced) out.push(`  ${pad(`Codex web searches (${b.webSearch.unpriced.toLocaleString("en-US")})`, 26)} ${lpad("", 8)}  ${dim("not priced (no OpenAI per-search fee in the price list)")}`);
  out.push("");
  out.push(bold("What that context was (estimated)"));
  out.push(dim("  Tokens count every re-read: a 1k-token result read by 50 later calls counts 50k."));
  for (const row of r.buckets) {
    if (row.cost < 0.005 && row.tokens < 1) continue;
    out.push(`  ${pad(row.label, 52)} ${lpad(fmtTokens(row.tokens), 8)}  ${lpad(fmtUsd(row.cost), 9)}  ${bar(row.cost / b.total.cost)}`);
  }
  out.push("");

  // 3. Savers
  if (r.savers.length) out.push(...saverSection(r, o, bold, dim));

  // 4. Biggest waste
  const top = r.waste.slice(0, 3);
  if (top.length) {
    out.push(bold("Biggest tool-output costs"));
    for (const w of top) {
      const where = o.showProjects ? w.projects.join(", ") : `${w.projects.length} project${w.projects.length === 1 ? "" : "s"}`;
      out.push(`  ${pad(w.label, 28)} ${lpad(fmtTokens(w.tokens), 8)}  ${lpad(fmtUsd(w.cost), 9)}  in ${where}`);
    }
    out.push("");
  }

  // 5. Caveats
  out.push(bold("How these numbers were made"));
  out.push("  Billed totals: recorded usage in your logs, deduplicated, priced at list prices.");
  const cal = r.calibration
    .filter((c) => c.basis !== "tokenizer")
    .map((c) => `${c.model} ×${c.k.toFixed(2)} (${c.quality}${c.basis === "none" ? ", uncalibrated" : c.basis === "family" ? `, via ${c.fittedOn} n=${c.n}` : `, n=${c.n}`})`);
  out.push("  Context split: o200k_base token counts" + (cal.length ? `, calibrated to each Claude model's usage: ${cal.join("; ")}.` : "."));
  if (r.calibration.some((c) => c.basis === "tokenizer")) out.push("  OpenAI models: o200k_base is their tokenizer (assumed for gpt-6).");
  out.push("  Claude Code attachments are sized from their stored fields; system prompt and tool definitions are not logged.");
  if (r.savers.length) {
    out.push("  Savers: measured by replaying your past sessions as they happened. A saver can also change");
    out.push("  how the agent works: e.g. extra steps to fetch back what it cut, different answers. That");
    out.push("  can raise or lower the real saving and is not measured here. Same prompt-cache pattern assumed.");
  }
  const unpriced = r.models.filter((m) => !m.pricedAs);
  if (unpriced.length) out.push(`  No price for: ${unpriced.map((m) => m.model).join(", ")} (tokens counted, $0).`);
  if (r.billing.webSearch.unpriced) out.push("  Codex web search fees are not in the total: the price list has no OpenAI per-search fee.");
  const fast = r.models.filter((m) => m.fastUnpriced);
  if (fast.length) out.push(`  Fast mode price unknown, standard rate used: ${fast.map((m) => `${m.model} (${plural(m.fastUnpriced!, "call")})`).join(", ")}.`);
  // A model priced as more than one (an alias that changed on a date) lists each with its calls.
  // A dated snapshot priced as its base model has a public price: not listed.
  const aliased = new Map<string, AuditResult["models"]>();
  for (const m of r.models) if (m.pricedAs && viaAlias(m.model, m.pricedAs)) aliased.set(m.model, [...(aliased.get(m.model) ?? []), m]);
  const as = (rows: AuditResult["models"]) => (rows.length === 1 ? rows[0]!.pricedAs : rows.map((m) => `${m.pricedAs} (${plural(m.calls, "call")})`).join(" / "));
  if (aliased.size) out.push(`  Priced as: ${[...aliased].map(([model, rows]) => `${model} → ${as(rows)}`).join(", ")} (no public price).`);
  out.push(`  Prices: snapshot of ${r.prices.date} (models.dev). Refresh with --update-prices (network).`);
  if (o.verbose || r.skipped.lines || r.skipped.unreadableFiles) {
    out.push(dim(`  Skipped: ${r.skipped.lines} unreadable lines, ${r.skipped.unreadableFiles} unreadable files, ${r.skipped.duplicateCalls} duplicate calls, ${r.skipped.notBillable} replayed-history calls, ${r.skipped.outsidePeriod} calls outside the period.`));
  }
  if (o.elapsedMs !== undefined) out.push(dim(`  ${r.files} log files read in ${(o.elapsedMs / 1000).toFixed(1)} s. Nothing left your machine.`));
  return out.join("\n") + "\n";
}

const METHOD: Record<string, string> = { replayed: "replayed", modeled: "modeled", "upper-bound": "upper bound" };

// One rule for replayed savers: no number when too little was measured (tooLittleData);
// otherwise "indicative" when any output was not measured (extrapolated, or failed and
// counted as unchanged), else "exact".

/** Too little measured to show a number (quick sample too small, or most replays failed). */
export function tooLittleData(s: AuditResult["savers"][number]): boolean {
  return s.method === "replayed" && !!s.replay?.insufficient;
}

/** A shown replayed number that is not fully measured: some outputs extrapolated or failed. */
export function isIndicative(s: AuditResult["savers"][number]): boolean {
  return s.method === "replayed" && !tooLittleData(s) && !!(s.replay?.extrapolated || s.replay?.failed);
}

/** Short confidence label: how much of the number is measured. */
export function confidence(s: AuditResult["savers"][number]): string {
  if (s.method === "upper-bound") return "ceiling";
  if (s.method === "modeled") return "assumed";
  if (tooLittleData(s)) return "not measured";
  return isIndicative(s) ? "indicative" : "exact";
}

/**
 * What a saver row says instead of a number; `exact` is how to ask for an exact run.
 * Failed replays are the cause only when they outnumber the measured ones (failedOut):
 * a few failures in a quick sample that was too small still need an exact run.
 */
function noNumber(s: AuditResult["savers"][number], exact: string): string {
  return s.replay?.failedOut ? `not measured: ${s.replay.reason ?? "replays failed"}` : `exact run needed: ${exact}`;
}

/** The share of outputs replayed, rounded down so a nearly complete replay never reads 100%. */
export function replayedShare(s: AuditResult["savers"][number]): string {
  const r = s.replay;
  if (!r || !s.replayTotal) return "100%";
  const x = 1 - r.extrapolated / s.replayTotal;
  if (x <= 0) return "0%";
  return `${x < 0.1 ? Math.max(Math.floor(x * 1000) / 10, 0.1).toFixed(1) : Math.floor(x * 100)}%`;
}

function saverSection(r: AuditResult, o: TerminalOptions, bold: (s: string) => string, dim: (s: string) => string): string[] {
  const out: string[] = [];
  const total = r.billing.total.cost;
  out.push(bold("What each token saver would have cut"));
  out.push(dim(`  ${pad("Saver", 24)} ${pad("Method", 12)} ${lpad("Covers", 7)} ${lpad("Tokens", 9)} ${lpad("Saved", 10)} ${lpad("of bill", 8)}  Confidence`));
  const shown = r.savers.filter((s) => s.status === "ok");
  for (const s of shown) {
    if (tooLittleData(s)) {
      out.push(`  ${pad(s.name, 24)} ${pad(METHOD[s.method]!, 12)} ${lpad("", 7)} ${lpad("", 9)} ${lpad("—", 10)} ${lpad("", 8)}  ${noNumber(s, "--exact")}`);
      continue;
    }
    const le = s.method === "upper-bound" ? "≤ " : "";
    const cost = s.cost < 0 ? `-${fmtUsd(-s.cost)}` : `${le}${fmtUsd(s.cost)}`;
    const tokens = s.tokens < 0 ? `-${fmtTokens(-s.tokens)}` : `${le}${fmtTokens(s.tokens)}`;
    const share = total ? `${((100 * s.cost) / total).toFixed(1)}%` : "—";
    const cov = s.method === "modeled" ? "—" : `${(100 * s.coverage).toFixed(0)}%`;
    out.push(`  ${pad(s.name, 24)} ${pad(METHOD[s.method]!, 12)} ${lpad(cov, 7)} ${lpad(tokens, 9)} ${lpad(cost, 10)} ${lpad(share, 8)}  ${confidence(s)}`);
  }
  const notes: string[] = [];
  for (const s of shown) {
    // A saver without a number already says why on its row.
    if (s.replay && !tooLittleData(s) && (s.replay.extrapolated || s.replay.failed)) {
      const parts = [];
      if (s.replay.extrapolated) parts.push(`indicative: ${replayedShare(s)} of its outputs replayed (quick mode), the other ${s.replay.extrapolated.toLocaleString("en-US")} extrapolated; --exact replays all`);
      if (s.replay.failed) parts.push(`${s.replay.failed.toLocaleString("en-US")} ${s.replay.failed === 1 ? "replay" : "replays"} failed and count as unchanged (tried again next run)`);
      notes.push(`${s.name}: ${parts.join("; ")}.`);
    }
    if (s.assumption) notes.push(`${s.name}: ${s.assumption}.`);
    if (s.installed && s.installed !== "version unknown" && !s.version.startsWith(s.installed)) notes.push(`${s.name}: installed ${s.installed}; this adapter was written for ${s.version}.`);
  }
  // Signed: a Codex part can be a net cost (caveman skill), never shown as a saving.
  const codex = shown.filter((s) => !tooLittleData(s) && hypotheticalCodex(s));
  if (codex.length) notes.push(`On Codex, hooks cannot rewrite tool input, so the Codex part of these numbers is hypothetical: ${codex.map((s) => `${s.name} ${signedUsd(s.codexCost)} of ${signedUsd(s.cost)}`).join(", ")}.`);
  notes.push("fast-jev-compaction is not in this table: it acts only at compaction and its keep/drop decisions need its hosted API, so offline replay has nothing honest to measure.");
  const missing = r.savers.filter((s) => s.status === "not installed");
  // As in the short view: a saver the installer cannot add here says why, not the install command.
  const how = (s: Saver) => o.install?.why.get(s.id) ?? s.install;
  if (missing.length) notes.push(`Not installed, so not replayed: ${missing.map((s) => (how(s) ? `${s.name} (${how(s)})` : s.name)).join(", ")}. saver-audit never bundles saver code.`);
  for (const n of notes) out.push(dim(`  · ${n}`));
  out.push("");
  return out;
}

/** One line for the savers that are not measured: the modeled one and the ceilings. */
export function unmeasuredLine(r: AuditResult): string {
  const total = r.billing.total.cost;
  if (!total) return "";
  const pct = (x: number) => `${((100 * x) / total).toFixed(1)}%`;
  const parts: string[] = [];
  for (const x of r.savers.filter((y) => y.status === "ok" && y.method === "modeled")) parts.push(`${x.name.replace(" (skill)", " skill")} ≈ ${pct(x.cost)} by JetBrains' figure`);
  const bounds = r.savers.filter((y) => y.status === "ok" && y.method === "upper-bound");
  if (bounds.length) parts.push(`${bounds.map((x) => `${x.name} ≤ ${pct(x.cost)}`).join(", ")} (best case)`);
  return parts.join("; ");
}
