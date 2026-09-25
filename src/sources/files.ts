import { createReadStream, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Recursively lists files modified at or after sinceMs (0 = all). Missing dirs are fine. */
export function listFiles(dir: string, sinceMs: number, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, sinceMs, out);
    else if (e.isFile()) {
      if (sinceMs > 0) {
        try {
          if (statSync(p).mtimeMs < sinceMs) continue;
        } catch {
          continue;
        }
      }
      out.push(p);
    }
  }
  return out;
}

/** Streams non-empty lines of a UTF-8 file without holding the whole file. */
export async function* readLines(file: string): AsyncGenerator<string> {
  const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  // Pieces of a line that spans chunks; joined once, so long lines stay linear.
  let pending: string[] = [];
  for await (const chunk of stream as AsyncIterable<string>) {
    let start = 0;
    for (let nl = chunk.indexOf("\n"); nl !== -1; nl = chunk.indexOf("\n", start)) {
      const piece = chunk.slice(start, nl);
      const line = pending.length ? pending.join("") + piece : piece;
      pending = [];
      if (line) yield line;
      start = nl + 1;
    }
    if (start < chunk.length) pending.push(chunk.slice(start));
  }
  const last = pending.join("");
  if (last.trim()) yield last;
}
