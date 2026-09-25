// Where `--install-savers` puts the savers. No network code here, so detection can
// import it on every run.
import { homedir } from "node:os";
import { join } from "node:path";

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
