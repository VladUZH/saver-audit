// Argument helpers. Kept out of cli.ts so importing them has no side effects.

/** `--card` takes an optional path: a bare `--card` means saver-audit.png. */
export function normalizeCardArg(argv: string[]): string[] {
  return argv.map((a, i) => (a === "--card" && (i + 1 >= argv.length || argv[i + 1]!.startsWith("-")) ? "--card=saver-audit.png" : a));
}

/** `--jobs`: worker threads, a whole number of at least 1; undefined when not given. */
export function parseJobs(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < 1) throw new Error(`--jobs: expected a whole number of at least 1, got ${v}`);
  return Number(v);
}
