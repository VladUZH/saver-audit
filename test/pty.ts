// Test helper: runs the CLI in a pseudo-terminal through the system's `script`, so the
// spinner and colours behave as in a real terminal.
import { spawnSync } from "node:child_process";

/**
 * Runs node with `args` in a pseudo-terminal (its input is empty) and returns what it
 * printed, stdout and stderr together; undefined when there is no usable `script` here.
 */
export function inTerminal(args: string[], o: { env: NodeJS.ProcessEnv; cwd?: string }): string | undefined {
  const cmd = [process.execPath, ...args];
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const argv = process.platform === "darwin" ? ["-q", "/dev/null", ...cmd] : process.platform === "linux" ? ["-qfec", cmd.map(q).join(" "), "/dev/null"] : undefined;
  if (!argv) return undefined;
  // macOS's script needs a terminal or a file as its input, not a pipe.
  const r = spawnSync("script", argv, { env: o.env, cwd: o.cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 60_000 });
  return r.error || r.status === null ? undefined : r.stdout;
}

/** Why terminal tests are skipped here, or false when they can run. */
export const noTerminal = inTerminal(["-e", "process.stdout.write(String(process.stdout.isTTY))"], { env: process.env })?.endsWith("true") ? false : "no pseudo-terminal (script) here";
