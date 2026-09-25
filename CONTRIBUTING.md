# Adding a saver

saver-audit measures token savers on people's own Claude Code and Codex logs. A saver is one JSON file, a *manifest*. If your tool can filter a tool output from stdin, it can be measured on every saver-audit user's sessions, and its row appears on their report and share card.

## What your saver needs

**A program that:**
- reads one tool output on **stdin**;
- writes what the agent would see instead on **stdout**;
- exits 0.

**It must be:**
- **deterministic:** the same input gives the same output;
- **offline:** no network while filtering;
- **fast:** it runs once per output, and a month of logs has tens of thousands.

It runs with `DO_NOT_TRACK=1`, a 60-second timeout per output, and a throwaway state folder if you ask for one.

**If it only works live**, for example it wraps and re-runs the command or needs a model API, it can't be replayed from logs. You can still add it as an **upper bound** (below), or add a stdin mode first. That is usually a small change.

## The manifest

Put it in `src/savers/builtin/<id>.json` for a pull request, or in `~/.saver-audit/savers/<id>.json` to try it on your own logs. Working examples:
- [`rtk.json`](src/savers/builtin/rtk.json): a hook-stage filter with one route per command type.
- [`caveman-engine.json`](src/savers/builtin/caveman-engine.json): a proxy-stage compressor with one route for everything.
- [`codegraph.json`](src/savers/builtin/codegraph.json) and [`context-mode.json`](src/savers/builtin/context-mode.json): upper bounds.

```json
{
  "id": "my-saver",
  "name": "my-saver",
  "repo": "https://github.com/me/my-saver",
  "version": "1.2.0",
  "licence": "MIT",
  "method": "replayed",
  "covers": "test and build output",
  "stage": "tool",
  "binary": "my-saver",
  "binaryEnv": "MY_SAVER_BIN",
  "versionArgs": ["--version"],
  "env": { "MY_SAVER_HOME": "{state}/my-saver" },
  "routes": [
    { "name": "pytest", "match": { "categories": ["Shell"], "command": "^(python3? -m )?pytest\\b" }, "args": ["filter", "--kind", "pytest"] },
    { "name": "logs", "match": { "families": ["build & lint"] }, "args": ["filter", "--kind", "log"] }
  ],
  "minTokens": 200,
  "codexHypothetical": true,
  "install": "brew install my-saver"
}
```

| Field | Meaning |
|---|---|
| `id` | Lowercase letters, digits and dashes. Must not clash with an existing saver. |
| `name`, `repo`, `version`, `licence`, `covers` | Shown in the report. `version` is the version your manifest was written for. |
| `method` | `replayed` (your program filters recorded output) or `upper-bound` (your tool changes how the agent works, so only a ceiling can be given). |
| `assumption` | Required for `upper-bound`: say what the ceiling assumes. Optional note for `replayed`. |
| `stage` | `tool` if your saver acts before the agent sees the output (a hook): it gets the full raw output, even where Claude Code showed the agent only a preview. `request` if it acts on what is sent to the model (a proxy). Default `request`. |
| `binary` | Your program, looked up on `PATH`, in `~/.saver-audit/tools/bin`, and in `paths`. |
| `binaryEnv`, `paths`, `versionArgs`, `env` | Optional. An override variable, extra folders (`~` = home), arguments that print the version, and extra environment (`{state}` = a temporary folder). |
| `routes` | The first route whose `match` fits the output is used; no match means your saver does not apply. `args` are passed to your program; `{command}` in an argument becomes the recorded shell command (e.g. `["compress", "{command}"]`), for filters that pick their rules by command. `name` becomes part of the cache key. |
| `match` | Any of: `tools` (e.g. `["Bash", "exec_command"]`), `categories` (`Shell`, `File reads`, `File edits`, `Search`, `Web fetch`, `Web search`, `Subagents`, `MCP tools`, `Other tools`), `families` (for shell: `tests`, `git`, `build & lint`, `search`, `file reading`, `listing & find`, `http`, `installs`, `scripts`, …), `command` (a regular expression over the shell command's last real segment), `excludeTools`, `minBytes`. |
| `minTokens` | Outputs smaller than this are counted as unchanged without running your program (saves time when small outputs are never touched). |
| `codexHypothetical` | `true` if your saver works through Claude Code hooks: Codex hooks cannot rewrite tool input, so its Codex numbers are marked hypothetical. |
| `install` | How to install it, shown when it is missing. |

**"Modeled" savers are not accepted as manifests.** These change the model's output style or rest on an estimate, and need a cited measurement, so they go through code review as code.

## Try it

```
npx saver-audit --check-saver my-saver.json   # validates, finds your program, runs it on a sample
cp my-saver.json ~/.saver-audit/savers/
npx saver-audit --savers my-saver --full-replay
```

## Pull request checklist

- [ ] The manifest is in `src/savers/builtin/`, and `npx saver-audit --check-saver` passes.
- [ ] Your program is published, with an install command in `install`.
- [ ] A small test fixture: an input and the expected output of your program, in `test/fixtures/savers/<id>/`.
- [ ] The licence allows people to run it. saver-audit never bundles or downloads community savers; users install them themselves.

## Other contributions

Parsers for more agents, parser fixes for new Claude Code / Codex versions, and price updates are welcome too:
- Test fixtures must be **synthetic**; never commit real session logs.
- `npm test` must pass.
