// Argument helpers. Kept out of cli.ts so importing them has no side effects.

/** `--card` takes an optional path: a bare `--card` means saver-audit.png. */
export function normalizeCardArg(argv: string[]): string[] {
  return argv.map((a, i) => (a === "--card" && (i + 1 >= argv.length || argv[i + 1]!.startsWith("-")) ? "--card=saver-audit.png" : a));
}
