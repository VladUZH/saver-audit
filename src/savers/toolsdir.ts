// Where `--install-savers` puts the savers. No network code here, so detection can
// import it on every run.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export function toolsDir(): string {
  return join(process.env.SAVER_AUDIT_HOME ?? join(homedir(), ".saver-audit"), "tools");
}

const EXE = process.platform === "win32" ? ".exe" : "";

export const toolPaths = {
  rtk: () => join(toolsDir(), "bin", `rtk${EXE}`),
  caveman: () => join(toolsDir(), "bin", `caveman-engine${EXE}`),
  headroomPython: () => join(toolsDir(), "headroom-venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python"),
  hfHome: () => join(toolsDir(), "hf"),
  headroomState: () => join(toolsDir(), "headroom-state"),
};

/** python3, python, then versioned names on PATH (a python3.12 next to an older python3), newest first. */
function pythonCandidates(): string[][] {
  if (process.platform === "win32") return [["py", "-3"], ["python"]];
  const versioned = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    try {
      for (const f of readdirSync(dir)) if (/^python3\.\d+$/.test(f)) versioned.add(f);
    } catch {
      // not a readable folder
    }
  }
  const minor = (name: string) => Number(name.slice("python3.".length));
  return [["python3"], ["python"], ...[...versioned].sort((a, b) => minor(b) - minor(a)).map((n) => [n])];
}

/**
 * A Python 3.10+ on PATH, as the interpreter's absolute path (sys.executable), so the
 * savers keep using it when run with another PATH or HOME (version-manager shims
 * resolve through HOME). Undefined when there is none.
 */
export function findPython(): string | undefined {
  for (const [cmd, ...pre] of pythonCandidates()) {
    const r = spawnSync(cmd!, [...pre, "-c", "import sys; print('%d.%d' % sys.version_info[:2]); print(sys.executable)"], { encoding: "utf8" });
    const [version = "", exe = ""] = (r.stdout ?? "").trim().split(/\r?\n/).map((l) => l.trim());
    const [maj, min] = version.split(".").map(Number);
    if (r.status !== 0 || !(maj! > 3 || (maj === 3 && min! >= 10))) continue;
    if (exe) return exe;
    if (!pre.length) return cmd;
  }
  return undefined;
}
