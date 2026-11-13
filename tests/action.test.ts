import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { command, capture } from "../src/agents/cli.js";
test("Action pins dependencies, always cleans up, and scopes credentials", () => {
  const action = parse(readFileSync("action.yml", "utf8"));
  assert.equal(action.inputs["api-url"].default, "https://sekirei-backend.tech-div.workers.dev");
  for (const step of action.runs.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const run = action.runs.steps.find((s: { id: string }) => s.id === "agent");
  assert.equal(run.env["INPUT_API-KEY"], undefined);
  assert.equal(run.env["INPUT_GITHUB-TOKEN"], undefined);
  assert.match(action.runs.steps.at(-1).if, /always\(\)/);
  assert.deepEqual(Object.keys(parse(readFileSync(".github/workflows/smoke.yml", "utf8")).on), ["workflow_dispatch"]);
  assert.ok(!readFileSync("src/main.ts", "utf8").includes("core.setSecret(result.skill.content)"));
});
test("provider CLI flags disable command execution and custom project settings", () => {
  const claude = command("claude", "/tmp/test", "");
  assert.ok(claude.args.includes("--bare")); assert.equal(claude.args[claude.args.indexOf("--tools") + 1], "");
  const codex = command("codex", "/tmp/test", "");
  assert.ok(codex.args.includes("features.shell_tool=false")); assert.ok(codex.args.includes("--ignore-user-config"));
});
test("process errors never echo raw stderr and timeouts stop the child", async () => {
  await assert.rejects(capture(process.execPath, ["-e", "console.error('secret-value');process.exit(1)"], { cwd: process.cwd(), env: {}, timeout: 5000 }), (e: unknown) => e instanceof Error && !e.message.includes("secret-value"));
  await assert.rejects(capture(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { cwd: process.cwd(), env: {}, timeout: 50 }), /time limit/);
});
