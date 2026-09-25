// The human report. Prints numbers, fixed labels and model names only: never prompts,
// paths, commands or tool output. Project names only with --show-projects.
import type { AuditResult } from "../audit.ts";

export interface TerminalOptions {
  showProjects: boolean;
  color: boolean;
  verbose: boolean;
  elapsedMs?: number;
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
  out.push(`${r.sessions.main} sessions (${bySource}) + ${r.sessions.subagent} subagent runs, ${r.calls.toLocaleString("en-US")} API calls, ${r.projects.length} projects`);
  out.push(`Models: ${r.models.map((m) => m.model).join(", ")}`);
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
    out.push("  Savers: offline replay cannot show whether a saver changes how the agent behaves");
    out.push("  (extra turns, retries, recalls, answer quality). Savings assume the same cache pattern.");
  }
  const unpriced = r.models.filter((m) => !m.pricedAs);
  if (unpriced.length) out.push(`  No price for: ${unpriced.map((m) => m.model).join(", ")} (tokens counted, $0).`);
  const aliased = r.models.filter((m) => m.pricedAs && m.pricedAs !== m.model && !m.model.includes("["));
  if (aliased.length) out.push(`  Priced as: ${aliased.map((m) => `${m.model} → ${m.pricedAs}`).join(", ")} (no public price).`);
  out.push(`  Prices: snapshot of ${r.prices.date} (models.dev). Refresh with --update-prices (network).`);
  if (o.verbose || r.skipped.lines || r.skipped.unreadableFiles) {
    out.push(dim(`  Skipped: ${r.skipped.lines} unreadable lines, ${r.skipped.unreadableFiles} unreadable files, ${r.skipped.duplicateCalls} duplicate calls, ${r.skipped.notBillable} replayed-history calls, ${r.skipped.outsidePeriod} calls outside the period.`));
  }
  if (o.elapsedMs !== undefined) out.push(dim(`  ${r.files} log files read in ${(o.elapsedMs / 1000).toFixed(1)} s. Nothing left your machine.`));
  return out.join("\n") + "\n";
}

const METHOD: Record<string, string> = { replayed: "replayed", modeled: "modeled", "upper-bound": "upper bound" };

/** Short confidence label: how much of the number is measured. */
export function confidence(s: AuditResult["savers"][number]): string {
  if (s.method === "upper-bound") return "ceiling";
  if (s.method === "modeled") return "assumed";
  const r = s.replay;
  if (!r || !r.extrapolated) return "high";
  const replayed = s.replayTotal ? 1 - r.extrapolated / s.replayTotal : 0;
  return `sample ${Math.max(replayed * 100, 0.1).toFixed(replayed < 0.1 ? 1 : 0)}%`;
}

function saverSection(r: AuditResult, o: TerminalOptions, bold: (s: string) => string, dim: (s: string) => string): string[] {
  const out: string[] = [];
  const total = r.billing.total.cost;
  out.push(bold("What each token saver would have cut"));
  out.push(dim(`  ${pad("Saver", 24)} ${pad("Method", 12)} ${lpad("Covers", 7)} ${lpad("Tokens", 9)} ${lpad("Saved", 10)} ${lpad("of bill", 8)}  Confidence`));
  const shown = r.savers.filter((s) => s.status === "ok");
  for (const s of shown) {
    const le = s.method === "upper-bound" ? "≤ " : "";
    const cost = s.cost < 0 ? `-${fmtUsd(-s.cost)}` : `${le}${fmtUsd(s.cost)}`;
    const tokens = s.tokens < 0 ? `-${fmtTokens(-s.tokens)}` : `${le}${fmtTokens(s.tokens)}`;
    const share = total ? `${((100 * s.cost) / total).toFixed(1)}%` : "—";
    const cov = s.method === "modeled" ? "—" : `${(100 * s.coverage).toFixed(0)}%`;
    out.push(`  ${pad(s.name, 24)} ${pad(METHOD[s.method]!, 12)} ${lpad(cov, 7)} ${lpad(tokens, 9)} ${lpad(cost, 10)} ${lpad(share, 8)}  ${confidence(s)}`);
  }
  const notes: string[] = [];
  for (const s of shown) {
    if (s.replay && (s.replay.extrapolated || s.replay.failed)) {
      const parts = [];
      if (s.replay.extrapolated) parts.push(`${s.replay.extrapolated.toLocaleString("en-US")} not yet replayed outputs extrapolated from the sample (--full-replay replays all)`);
      if (s.replay.failed) parts.push(`${s.replay.failed.toLocaleString("en-US")} failed`);
      notes.push(`${s.name}: ${parts.join("; ")}.`);
    }
    if (s.assumption) notes.push(`${s.name}: ${s.assumption}.`);
    if (s.installed && s.installed !== "version unknown" && !s.version.startsWith(s.installed)) notes.push(`${s.name}: installed ${s.installed}; this adapter was written for ${s.version}.`);
  }
  const codex = shown.filter((s) => s.codexHypothetical && Math.abs(s.codexCost) >= 0.005);
  if (codex.length) notes.push(`On Codex, hooks cannot rewrite tool input, so these Codex savings are hypothetical: ${codex.map((s) => `${s.name} ${fmtUsd(Math.abs(s.codexCost))}`).join(", ")}.`);
  notes.push("fast-jev-compaction is not in this table: it acts only at compaction and its keep/drop decisions need its hosted API, so offline replay has nothing honest to measure.");
  const missing = r.savers.filter((s) => s.status === "not installed");
  if (missing.length) notes.push(`Not installed, so not replayed: ${missing.map((s) => s.name).join(", ")}. saver-audit calls your installed copy; it never bundles saver code.`);
  for (const n of notes) out.push(dim(`  · ${n}`));
  out.push("");
  return out;
}
