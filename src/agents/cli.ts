import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Agent } from "../types.js";

export const versions = { claude: "2.1.323", codex: "0.168.0" } as const;
export function command(agent: Agent, dir: string, model: string) {
  const tooling = join(dir, "tooling/node_modules");
  if (agent === "claude") return {
    executable: join(tooling, "@anthropic-ai/claude-code-linux-x64/claude"),
    args: ["--bare", "-p", "--tools", "", "--disallowedTools", "mcp__*", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--no-session-persistence", "--output-format", "json", "--json-schema", "SCHEMA", ...(model ? ["--model", model] : [])],
  };
  return {
    executable: process.execPath,
    args: [join(tooling, "@openai/codex/bin/codex.js"), "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
      "--sandbox", "read-only", "-c", "features.shell_tool=false", "-c", "features.multi_agent=false", "-c", 'web_search="disabled"',
      "--output-schema", join(dir, "schema.json"), "--output-last-message", join(dir, "result.json"), ...(model ? ["--model", model] : []), "-"],
  };
}
export function capture(executable: string, args: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; input?: string; timeout: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    const chunks: Buffer[] = [];
    let bytes = 0, failure: string | undefined;
    const stop = (reason: string) => {
      failure = reason;
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(() => stop("Process exceeded its time limit."), options.timeout);
    child.stdout.on("data", (data: Buffer) => {
      bytes += data.length;
      if (bytes > 8 * 1024 * 1024) stop("Process output exceeded its size limit.");
      else chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => { bytes += data.length; if (bytes > 8 * 1024 * 1024) stop("Process output exceeded its size limit."); });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Could not start the selected CLI.")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(new Error(failure ?? `Selected CLI failed (exit ${code}). Check provider credentials, model access and quota.`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}
export async function runAgent(agent: Agent, dir: string, model: string, key: string, timeout: number) {
  const cwd = join(dir, "isolated");
  await mkdir(cwd, { recursive: true });
  const spec = command(agent, dir, model);
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", CI: "true", NO_COLOR: "1" };
  // Only the selected provider key is inherited. No GitHub or SaaS credentials.
  if (agent === "claude") {
    env.ANTHROPIC_API_KEY = key;
    env.CLAUDE_CONFIG_DIR = join(dir, "claude-config");
    spec.args[spec.args.indexOf("SCHEMA")] = await readFile(join(dir, "schema.json"), "utf8");
  } else env.CODEX_API_KEY = key;
  const output = await capture(spec.executable, spec.args, {
    cwd, env, input: await readFile(join(dir, "prompt.txt"), "utf8"), timeout,
  });
  try {
    if (agent === "claude") {
      const result = JSON.parse(output);
      if (result.is_error || result.subtype !== "success" || !result.structured_output) throw new Error();
      return result.structured_output as unknown;
    }
    return JSON.parse(await readFile(join(dir, "result.json"), "utf8")) as unknown;
  } catch { throw new Error("Selected CLI did not return a complete structured result."); }
}
