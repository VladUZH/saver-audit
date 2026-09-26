// --last / --since / --until parsing. Kept out of cli.ts so importing it has no side effects.

/**
 * A --since or --until value: a date (YYYY-MM-DD, local time; the start of that day, or
 * with `endOfDay` its last millisecond) or a date with a time (2026-09-20T10:00, local
 * unless it names a zone). Anything else, or a day the month does not have, is an error.
 */
function parseDay(flag: string, v: string, endOfDay: boolean): number {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d.*))?$/.exec(v.trim());
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // Date rolls 2026-02-30 over into March: check the day exists.
    const day = new Date(Date.UTC(y, mo - 1, d));
    if (day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d) {
      const t = m[4] === undefined ? (endOfDay ? new Date(y, mo - 1, d, 23, 59, 59, 999) : new Date(y, mo - 1, d)).getTime() : Date.parse(`${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}T${m[4]}`);
      if (!Number.isNaN(t)) return t;
    }
  }
  throw new Error(`${flag}: not a date: ${v} (expected YYYY-MM-DD, or a time such as 2026-09-20T10:00)`);
}

export function parsePeriod(last: string | undefined, since: string | undefined, now: number): number {
  if (since) return parseDay("--since", since, false);
  const m = /^(\d+)([dwh])$/.exec(last ?? "30d");
  if (!m) throw new Error(`--last: expected e.g. 30d, 2w or 12h, got ${last}`);
  const unit = m[2] === "h" ? 3600e3 : m[2] === "w" ? 7 * 864e5 : 864e5;
  return now - Number(m[1]) * unit;
}

/** End of the period: --until date (end of that day when only a date is given), else now. */
export function parseUntil(until: string | undefined, now: number): number {
  return until ? parseDay("--until", until, true) : now;
}
