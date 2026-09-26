import { createReadStream, lstatSync, readdirSync, realpathSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";

/**
 * Recursively lists files modified at or after sinceMs (0 = all). Missing dirs are fine.
 * Symbolic links are followed. `seen` holds real paths, so a link loop ends and a folder
 * or file reached twice (two roots that are the same folder) is listed once.
 */
export function listFiles(dir: string, sinceMs: number, out: string[] = [], seen = new Set<string>()): string[] {
  let real: string;
  let entries;
  try {
    real = realpathSync(dir);
    if (seen.has(real)) return out;
    seen.add(real);
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st: Stats | undefined;
    if (e.isSymbolicLink()) {
      try {
        st = statSync(p);
      } catch {
        // Broken link: listed anyway, so reading it fails and it is counted as unreadable.
        try {
          if (!sinceMs || lstatSync(p).mtimeMs >= sinceMs) out.push(p);
        } catch {}
        continue;
      }
    }
    if (st ? st.isDirectory() : e.isDirectory()) listFiles(p, sinceMs, out, seen);
    else if (st ? st.isFile() : e.isFile()) {
      try {
        const file = st ? realpathSync(p) : join(real, e.name);
        if (seen.has(file)) continue;
        seen.add(file);
        if (sinceMs > 0 && (st ?? statSync(p)).mtimeMs < sinceMs) continue;
      } catch {
        continue;
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
