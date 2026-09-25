// --last / --since parsing. Kept out of cli.ts so importing it has no side effects.

export function parsePeriod(last: string | undefined, since: string | undefined, now: number): number {
  if (since) {
    const t = Date.parse(since.length === 10 ? `${since}T00:00:00` : since);
    if (Number.isNaN(t)) throw new Error(`--since: not a date: ${since}`);
    return t;
  }
  const m = /^(\d+)([dwh])$/.exec(last ?? "30d");
  if (!m) throw new Error(`--last: expected e.g. 30d, 2w or 12h, got ${last}`);
  const unit = m[2] === "h" ? 3600e3 : m[2] === "w" ? 7 * 864e5 : 864e5;
  return now - Number(m[1]) * unit;
}

/** End of the period: --until date (end of that day when only a date is given), else now. */
export function parseUntil(until: string | undefined, now: number): number {
  if (!until) return now;
  const t = Date.parse(until.length === 10 ? `${until}T23:59:59.999` : until);
  if (Number.isNaN(t)) throw new Error(`--until: not a date: ${until}`);
  return t;
}
