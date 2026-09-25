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
  const day = (iso: string) => iso.slice(0, 10);

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

  // 4. Biggest waste (3 is the saver table, added in M2)
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
    .map((c) => `${c.model} ×${c.k.toFixed(2)} (${c.quality}${c.basis === "none" ? ", uncalibrated" : `, n=${c.n}`})`);
  out.push("  Context split: o200k_base token counts" + (cal.length ? `, calibrated to each Claude model's usage: ${cal.join("; ")}.` : "."));
  if (r.calibration.some((c) => c.basis === "tokenizer")) out.push("  OpenAI models: o200k_base is their tokenizer (assumed for gpt-6).");
  out.push("  Claude Code attachments are sized from their stored fields; system prompt and tool definitions are not logged.");
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
