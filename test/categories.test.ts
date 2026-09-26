import { test } from "node:test";
import assert from "node:assert/strict";
import { shellFamily, toolCategory } from "../src/accounting/categories.ts";

test("shell families", () => {
  const cases: Array<[string, string]> = [
    ["cd /x && pytest -q", "tests"],
    ["npm test", "tests"],
    ["npm run test:unit", "tests"],
    ["cargo test --all", "tests"],
    ["go test ./...", "tests"],
    ["npm run build", "build & lint"],
    ["npm install", "installs"],
    ["git log --oneline | head", "git"],
    ["FOO=1 rg pattern src", "search"],
    ["sed -n 1,80p file.ts", "file reading"],
    ["./my_private_deploy.sh --prod", "other"],
    ["", "other"],
  ];
  for (const [cmd, fam] of cases) assert.equal(shellFamily(cmd), fam, cmd);
});

test("shell families: wrapper arguments and subshells are skipped", () => {
  const cases: Array<[string, string]> = [
    ["timeout 120 npm test", "tests"],
    ["timeout 60 pytest -q", "tests"],
    ["cd x && timeout 30 cargo test", "tests"],
    ["timeout -s KILL 1.5m make", "build & lint"],
    ["nice -n 10 make", "build & lint"],
    ["sudo -u www git pull", "git"],
    ["xargs -n 1 grep foo", "search"],
    ["env -u FOO FOO2=1 rg x", "search"],
    ["(cd web && npm test)", "tests"],
    ["( cd web && npm test )", "tests"],
    ["{ cd web; make; }", "build & lint"],
    ["time npm test", "tests"],
  ];
  for (const [cmd, fam] of cases) assert.equal(shellFamily(cmd), fam, cmd);
});

test("shell families: programs started through a package runner", () => {
  const cases: Array<[string, string]> = [
    ["npx eslint src", "build & lint"],
    ["npx prettier --check .", "build & lint"],
    ["pnpm exec prettier --check .", "build & lint"],
    ["npx vite build", "build & lint"],
    ["yarn webpack", "build & lint"],
    ["npm run eslint", "build & lint"],
    ["bunx eslint .", "build & lint"],
    ["uv run ruff check .", "build & lint"],
    ["bundle exec rspec", "tests"],
    ["npx ./node_modules/.bin/eslint src", "build & lint"],
    ["npm run dev", "scripts"],
    ["npx some-private-tool", "scripts"],
    ["cargo run -- ls", "scripts"],
    ["npm ls", "scripts"],
  ];
  for (const [cmd, fam] of cases) assert.equal(shellFamily(cmd), fam, cmd);
});

test("tool categories never echo unknown names", () => {
  assert.equal(toolCategory("Bash"), "Shell");
  assert.equal(toolCategory("mcp__private_server__tool"), "MCP tools");
  assert.equal(toolCategory("SomethingNew"), "Other tools");
  assert.equal(toolCategory("exec"), "Shell");
});
