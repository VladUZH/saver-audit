// Maps tool names and shell commands to report categories. Output labels come only
// from the fixed tables below, never from log text, so nothing private can leak
// through a category name.

export type Category =
  | "Shell"
  | "File reads"
  | "File edits"
  | "Search"
  | "Web fetch"
  | "Web search"
  | "Subagents"
  | "MCP tools"
  | "Other tools";

const CLAUDE_TOOLS: Record<string, Category> = {
  Bash: "Shell", BashOutput: "Shell", KillShell: "Shell", KillBash: "Shell", Monitor: "Shell",
  Read: "File reads", NotebookRead: "File reads",
  Edit: "File edits", MultiEdit: "File edits", Write: "File edits", NotebookEdit: "File edits",
  Grep: "Search", Glob: "Search", LS: "Search", ToolSearch: "Search",
  WebFetch: "Web fetch", WebSearch: "Web search",
  Agent: "Subagents", Task: "Subagents", SendMessage: "Subagents", TaskOutput: "Subagents",
  TaskStop: "Subagents", Workflow: "Subagents", SubagentHandback: "Subagents", ListAgents: "Subagents",
};

const CODEX_TOOLS: Record<string, Category> = {
  exec: "Shell", exec_command: "Shell", shell: "Shell", shell_command: "Shell", local_shell_call: "Shell",
  write_stdin: "Shell", "container.exec": "Shell", js: "Shell", run: "Shell",
  apply_patch: "File edits", view_image: "File reads",
  web_search_call: "Web search",
  spawn_agent: "Subagents", wait_agent: "Subagents", send_message: "Subagents",
  followup_task: "Subagents", list_agents: "Subagents", interrupt_agent: "Subagents",
  wait: "Subagents", read_thread: "Subagents", list_threads: "Subagents",
};

export function toolCategory(tool: string): Category {
  if (tool.startsWith("mcp__") || tool.startsWith("mcp.") || tool.startsWith("_")) return "MCP tools";
  return CLAUDE_TOOLS[tool] ?? CODEX_TOOLS[tool] ?? "Other tools";
}

// Shell families. Keys are program names; values are report labels.
const PROGRAMS: Record<string, string> = {
  git: "git", gh: "git",
  pytest: "tests", vitest: "tests", jest: "tests", mocha: "tests", phpunit: "tests", rspec: "tests",
  tsc: "build & lint", eslint: "build & lint", prettier: "build & lint", ruff: "build & lint",
  mypy: "build & lint", make: "build & lint", cmake: "build & lint", xcodebuild: "build & lint",
  swift: "build & lint", gradle: "build & lint", mvn: "build & lint", esbuild: "build & lint",
  vite: "build & lint", webpack: "build & lint", rustc: "build & lint", gcc: "build & lint",
  clang: "build & lint", javac: "build & lint", dotnet: "build & lint",
  cat: "file reading", head: "file reading", tail: "file reading", less: "file reading",
  sed: "file reading", awk: "file reading", nl: "file reading", wc: "file reading", jq: "file reading",
  ls: "listing & find", find: "listing & find", fd: "listing & find", tree: "listing & find",
  du: "listing & find", stat: "listing & find", file: "listing & find",
  grep: "search", rg: "search", ag: "search", egrep: "search",
  curl: "http", wget: "http", http: "http",
  pip: "installs", pip3: "installs", brew: "installs", apt: "installs", "apt-get": "installs",
  node: "scripts", python: "scripts", python3: "scripts", ruby: "scripts", bash: "scripts",
  sh: "scripts", zsh: "scripts", deno: "scripts", bun: "scripts", tsx: "scripts",
  docker: "containers & cloud", kubectl: "containers & cloud", gcloud: "containers & cloud",
  aws: "containers & cloud", vercel: "containers & cloud", railway: "containers & cloud",
  ps: "system", kill: "system", lsof: "system", top: "system", sleep: "system", open: "system",
  sqlite3: "databases", psql: "databases", mysql: "databases", redis: "databases",
};
const PKG_MANAGERS = new Set(["npm", "npx", "bunx", "pnpx", "pnpm", "yarn", "uv", "cargo", "go", "poetry", "bundle", "composer"]);
const PKG_BUILD = new Set(["build", "tsc", "lint", "check", "vet", "fmt", "typecheck", "clippy"]);
const PKG_INSTALL = new Set(["install", "i", "add", "ci", "sync", "update", "get", "fetch"]);
const WRAPPERS = new Set(["sudo", "time", "env", "nice", "timeout", "exec", "command", "xargs", "nohup"]);
// Wrapper options that take the next word as their value, e.g. `nice -n 10`, `sudo -u www`.
const WRAPPER_OPTS: Record<string, Set<string>> = {
  sudo: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U", "-T", "-R"]),
  env: new Set(["-u", "-C", "-S"]),
  nice: new Set(["-n"]),
  timeout: new Set(["-s", "-k"]),
  xargs: new Set(["-n", "-I", "-L", "-P", "-s", "-d", "-E", "-a", "-J", "-R", "-S"]),
};
const DURATION = /^\d+(\.\d+)?[smhd]?$/;

/** The program a package runner starts: `npx eslint`, `pnpm exec prettier`, `uv run ruff`, `yarn webpack`. */
function runTarget(prog: string, rest: string[]): string | undefined {
  if (prog === "npx" || prog === "bunx" || prog === "pnpx") return rest[0];
  if (prog === "cargo" || prog === "go") return undefined; // they run the project's own code
  if (rest[0] === "exec" || rest[0] === "dlx" || rest[0] === "x" || rest[0] === "run") return rest[1];
  return prog === "yarn" || prog === "pnpm" ? rest[0] : undefined;
}

/** Index of the program in a command's words: past env assignments, wrappers and their options (`sudo -u www git pull`). */
export function programIndex(words: string[]): number {
  let i = 0;
  let wrapper = "";
  while (i < words.length) {
    const w = words[i]!;
    if (WRAPPERS.has(w)) wrapper = w;
    else if (w.startsWith("-")) {
      if (WRAPPER_OPTS[wrapper]?.has(w)) i++; // skip its value
    } else if (wrapper === "timeout" && DURATION.test(w)) wrapper = "";
    else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) break;
    i++;
  }
  return i;
}

/** Classifies a shell command into a fixed family label. */
export function shellFamily(command: string): string {
  // First real command: drop leading `cd …&&`, env assignments and wrappers.
  const segments = command.split(/&&|\|\||;|\n|\|/);
  for (const seg of segments) {
    // Subshells and groups: `(cd web && npm test)`, `{ make; }`.
    const words = seg.trim().split(/\s+/).map((w) => w.replace(/^\(+|\)+$/g, "")).filter((w) => w && w !== "{");
    const i = programIndex(words);
    const prog = words[i]?.replace(/^.*\//, "");
    if (!prog || prog === "cd" || prog === "echo" || prog === "set" || prog === "export" || prog === "source") continue;
    const rest = words.slice(i + 1).filter((w) => !w.startsWith("-"));
    if (/(^|\s)test(\s|$)|pytest|vitest|jest/.test(words.slice(i, i + 4).join(" ")) && (PKG_MANAGERS.has(prog) || prog === "python" || prog === "python3" || prog === "node" || prog === "make" || prog === "swift" || prog === "xcodebuild" || prog === "gradle" || prog === "mvn" || prog === "dotnet")) {
      return "tests";
    }
    if (PKG_MANAGERS.has(prog)) {
      const sub = prog === "npm" || prog === "pnpm" || prog === "yarn" ? (rest[0] === "run" ? rest[1] : rest[0]) : rest[0];
      if (sub && /^test(:|$)/.test(sub)) return "tests";
      if (sub && PKG_INSTALL.has(sub)) return "installs";
      if (sub && (PKG_BUILD.has(sub) || /^(build|lint|typecheck|check)(:|$)/.test(sub))) return "build & lint";
      const bin = runTarget(prog, rest)?.replace(/^.*\//, "");
      return (bin && PROGRAMS[bin]) || "scripts";
    }
    return PROGRAMS[prog] ?? "other";
  }
  return "other";
}
