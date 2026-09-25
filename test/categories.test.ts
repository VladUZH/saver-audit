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

test("tool categories never echo unknown names", () => {
  assert.equal(toolCategory("Bash"), "Shell");
  assert.equal(toolCategory("mcp__private_server__tool"), "MCP tools");
  assert.equal(toolCategory("SomethingNew"), "Other tools");
  assert.equal(toolCategory("exec"), "Shell");
});
