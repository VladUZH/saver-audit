// Test helper: runs the CLI in a pseudo-terminal through the system's `script`, so the
// spinner and colours behave as in a real terminal.
import { spawn, spawnSync } from "node:child_process";

/** `script`'s arguments to run node with `args` in a pseudo-terminal; undefined where there is none. */
function scriptArgs(args: string[]): string[] | undefined {
  const cmd = [process.execPath, ...args];
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  return process.platform === "darwin" ? ["-q", "/dev/null", ...cmd] : process.platform === "linux" ? ["-qfec", cmd.map(q).join(" "), "/dev/null"] : undefined;
}

/**
 * Runs node with `args` in a pseudo-terminal (its input is empty) and returns what it
 * printed, stdout and stderr together; undefined when there is no usable `script` here.
 */
export function inTerminal(args: string[], o: { env: NodeJS.ProcessEnv; cwd?: string }): string | undefined {
  const argv = scriptArgs(args);
  if (!argv) return undefined;
  // macOS's script needs a terminal or a file as its input, not a pipe.
  const r = spawnSync("script", argv, { env: o.env, cwd: o.cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 60_000 });
  return r.error || r.status === null ? undefined : r.stdout;
}

/**
 * Like inTerminal, for a program that waits for keys (the menu): once it has printed
 * `until`, the terminal is closed, which ends it. Resolves with what it printed.
 */
export function inTerminalUntil(args: string[], o: { env: NodeJS.ProcessEnv; cwd?: string }, until: RegExp): Promise<string | undefined> {
  const argv = scriptArgs(args);
  if (!argv) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const p = spawn("script", argv, { env: o.env, cwd: o.cwd, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), 60_000);
    p.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      if (until.test(out)) p.kill("SIGKILL");
    });
    p.on("error", () => resolve(undefined));
    p.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/** Why terminal tests are skipped here, or false when they can run. */
export const noTerminal = inTerminal(["-e", "process.stdout.write(String(process.stdout.isTTY))"], { env: process.env })?.endsWith("true") ? false : "no pseudo-terminal (script) here";
