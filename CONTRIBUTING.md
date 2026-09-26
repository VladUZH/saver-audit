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

It runs with `DO_NOT_TRACK=1`, a 60-second timeout per output, and a throwaway state folder if you ask for one. It also runs:
- in an empty working folder, so a config file where saver-audit is started has no effect;
- without the network: web requests go to a proxy on a local port where nothing listens;
- without the user's own `CAVEMAN_*` and `TOKEN_SAVER_*` settings;
- on macOS and Linux, in its own process group: on a timeout it is stopped together with anything it started.

A run that fails (non-zero exit, timeout, output that can't be read) counts as unchanged for that run. It is not cached, so it is tried again next time. When most runs fail, the report shows "not measured" instead of a number.

**If it only works live**, for example it wraps and re-runs the command or needs a model API, it can't be replayed from logs. You can still add it as an **upper bound** (below), or add a stdin mode first. That is usually a small change.

## The manifest

Put it in `src/savers/builtin/<id>.json` for a pull request, and register it in `src/savers/registry.ts` (see the checklist). To try it on your own logs, put it in `~/.saver-audit/savers/<id>.json` instead. Working examples:
- [`rtk.json`](src/savers/builtin/rtk.json): a hook-stage filter with one route per command type.
- [`caveman-engine.json`](src/savers/builtin/caveman-engine.json): a proxy-stage compressor with one route for everything.
- [`token-saver.json`](src/savers/builtin/token-saver.json): passes the recorded command with `{command}`.
- [`lean-ctx.json`](src/savers/builtin/lean-ctx.json): two routes (shell and file reads), and reports counts via `jsonRatio`.
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
| `id` | Lowercase letters, digits and dashes. Must not clash with an existing saver; `headroom` and `caveman-skill` are taken too. |
| `name`, `repo`, `version`, `licence`, `covers` | Shown in the report. `version` is the version your manifest was written for. |
| `method` | `replayed` (your program filters recorded output) or `upper-bound` (your tool changes how the agent works, so only a ceiling can be given). |
| `assumption` | Required for `upper-bound`: say what the ceiling assumes. Optional note for `replayed`. |
| `stage` | `tool` if your saver acts before the agent sees the output (a hook): it gets the full raw output, even where Claude Code showed the agent only a preview, and `minBytes` and `minTokens` are checked against that full output. `request` if it acts on what is sent to the model (a proxy): it gets, and is sized by, what was sent. Default `request`. |
| `binary` | Your program, looked up on `PATH`, then in `~/.saver-audit/tools/bin`, then in `paths`. The first copy whose version is not older than `version` is used, or the first one found if none is. |
| `binaryEnv`, `paths`, `versionArgs`, `env` | Optional. An override variable (it always wins; empty counts as unset), extra folders (`~` = home), arguments that print the version, and extra environment (`{state}` = a temporary folder). The version is the number in the first line your program prints (`my-saver v1.2.0` gives `1.2.0`), and the version check runs with `env` too. A copy in `~/.saver-audit/tools/bin` whose version check fails counts as not installed. When the installed version differs from `version`, cached results are measured again. |
| `routes` | The first route whose `match` fits the output is used; no match means your saver does not apply. `args` are passed to your program; `{command}` in an argument becomes the recorded shell command, exactly as recorded (e.g. `["compress", "{command}"]`), for filters that pick their rules by command. A route that uses `{command}` fits only outputs with a recorded command; for the others, later routes are tried. `name` becomes part of the cache key. |
| `match` | Any of: `tools` (e.g. `["Bash", "exec_command"]`), `categories` (`Shell`, `File reads`, `File edits`, `Search`, `Web fetch`, `Web search`, `Subagents`, `MCP tools`, `Other tools`), `families` (for shell: `tests`, `git`, `build & lint`, `search`, `file reading`, `listing & find`, `http`, `installs`, `scripts`, …), `command`, `excludeTools`, `minBytes`. `command` is a regular expression over the shell command's last real segment. Continued lines are joined first. The segment starts at the program rtk's hook (`rtk rewrite`) would rewrite: env assignments (also after `env`), the keywords `exec`, `command`, `builtin`, `noglob` and `nocorrect`, and `timeout`, `time`, `nice` and `nohup` with the options rtk knows are skipped, and so is the `)` closing a subshell. So `timeout -s KILL 60 cargo test` is matched as `cargo test`. Nothing else is skipped: `sudo -u www git diff`, `xargs -n 1 grep foo`, `env -u HOME pytest`, `command -v rg`, `(pytest -q)` and `{ pytest -q; }` stay as they are, because rtk leaves those commands alone. |
| `minTokens` | Outputs smaller than this are counted as unchanged without running your program (saves time when small outputs are never touched). |
| `codexHypothetical` | `true` if your saver works through Claude Code hooks: Codex hooks cannot rewrite tool input, so its Codex numbers are marked hypothetical. |
| `install` | How to install it, shown when it is missing. |
| `jsonRatio` | Only if your program prints counts instead of the filtered text, as JSON: `{ "before": "<field>", "after": "<field>", "afterBytes": "<field>" }`. saver-audit applies your before/after ratio to its own token count of the same output, and says so in the report. Printing the text is preferred. |

saver-audit checks the type of every field it uses. A manifest with a problem is skipped, and the problem is listed (`--verbose`, `--check-saver`).

**"Modeled" savers are not accepted as manifests.** These change the model's output style or rest on an estimate, and need a cited measurement, so they go through code review as code.

## Try it

```
npx saver-audit --check-saver my-saver.json   # validates, finds your program, runs it on a sample
cp my-saver.json ~/.saver-audit/savers/
npx saver-audit --savers my-saver --exact
```

`--check-saver` runs your first route the way a replay does:
- `{command}` becomes `pytest -q`;
- it uses your `env`, with `{state}` set to a temporary folder that is removed afterwards;
- it uses saver-audit's replay environment (telemetry off, no network, the user's `CAVEMAN_*` and `TOKEN_SAVER_*` settings left out) and an empty working folder.

With `jsonRatio`, the check fails when your program's output lacks the before and after numbers.

An id that is taken is listed too. `headroom` and `caveman-skill` fail the check. The id of a built-in manifest (such as `rtk`) is noted, and the check still runs, so a change to a built-in manifest can be checked; a copy in `~/.saver-audit/savers/` with that id would be skipped.

## Pull request checklist

- [ ] The manifest is in `src/savers/builtin/<id>.json`, and `npx saver-audit --check-saver` passes.
- [ ] It is registered: `src/savers/registry.ts` imports it and adds it to `BUILTIN` (and to `ORDER` if it should rank with the launch set). A file in `builtin/` is not loaded otherwise, and `npm test` fails.
- [ ] Your program is published, with an install command in `install`.
- [ ] A small test fixture: an input and the expected output of your program, in `test/fixtures/savers/<id>/`.
- [ ] The licence allows people to run it. saver-audit never bundles or downloads community savers; users install them themselves.

## Other contributions

Parsers for more agents, parser fixes for new Claude Code / Codex versions, and price updates are welcome too:
- Test fixtures must be **synthetic**; never commit real session logs.
- `npm test` must pass.
