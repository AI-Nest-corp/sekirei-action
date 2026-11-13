import { execFileSync } from "node:child_process";
import type { ScanType, Scope } from "../types.js";

const sha = /^[a-f0-9]{40}$/;
export function git(cwd: string, args: string[]): Buffer {
  return execFileSync("git", ["--no-pager", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
}
export function changedPaths(raw: Buffer): string[] {
  const fields = raw.toString("utf8").split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++];
    const first = fields[i++];
    if (!status || first === undefined) throw new Error("Invalid Git diff.");
    paths.push(first);
    if (/^[RC]/.test(status)) {
      const second = fields[i++];
      if (second === undefined) throw new Error("Invalid Git rename.");
      paths.push(second);
    }
  }
  return [...new Set(paths)];
}
function excluded(path: string): boolean {
  return /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|\.cloudflare)\//.test(path) ||
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(path) ||
    /\.(min\.(js|css)|map|png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|mp4|mp3)$/i.test(path);
}
export function collectScope(cwd: string, scanType: ScanType, commit: string, baseSha: string | null): Scope {
  if (!sha.test(commit) || (baseSha !== null && !sha.test(baseSha))) throw new Error("Invalid commit.");
  if (git(cwd, ["rev-parse", "HEAD"]).toString().trim() !== commit)
    throw new Error("Checkout must match the target head commit. Set checkout ref to the PR head SHA.");
  const base = scanType === "diff"
    ? git(cwd, ["merge-base", baseSha ?? "", commit]).toString().trim() : null;
  if (base !== null && !sha.test(base)) throw new Error("Could not resolve merge-base. Use fetch-depth: 0.");
  const tree = (ref: string) => new Map(git(cwd, ["ls-tree", "-rz", "--full-tree", ref]).toString("utf8")
    .split("\0").filter(Boolean).map((row) => {
      const [meta, ...rest] = row.split("\t");
      const [mode, type, oid] = meta.split(" ");
      return [rest.join("\t"), { mode, type, oid }] as const;
    }));
  const current = tree(commit), old = base ? tree(base) : new Map();
  const targets = base ? changedPaths(git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", base, commit])) : [...current.keys()];
  const ordered = [...new Set([...targets, ...(base ? [...current.keys()] : [])])];
  const scope: Scope = { scanType, commit, base, files: [], omitted: [], targets };
  let bytes = 0;
  for (const path of ordered) {
    const item = current.get(path) ?? old.get(path);
    let reason = "";
    if (/[\x00-\x1f\x7f]/.test(path) || path.startsWith("/") || path.split("/").includes("..")) reason = "unsupported-path";
    else if (excluded(path)) reason = "excluded-generated-or-dependency";
    else if (!item || item.type !== "blob" || !["100644", "100755"].includes(item.mode)) reason = "excluded-symlink-or-submodule";
    else if (scope.files.length >= 100) reason = "file-count-limit";
    else if (Number(git(cwd, ["cat-file", "-s", item.oid]).toString()) > 48 * 1024) reason = "file-size-limit";
    if (reason) { scope.omitted.push({ path, reason }); continue; }
    const data = git(cwd, ["cat-file", "blob", item!.oid]);
    if (data.includes(0)) { scope.omitted.push({ path, reason: "excluded-binary" }); continue; }
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(data); }
    catch { scope.omitted.push({ path, reason: "unsupported-encoding" }); continue; }
    const patch = base && targets.includes(path) ? git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--unified=3", base, commit, "--", path]).toString("utf8") : null;
    const size = data.length + Buffer.byteLength(patch ?? "");
    if (bytes + size > 256 * 1024) { scope.omitted.push({ path, reason: "total-size-limit" }); continue; }
    bytes += size;
    scope.files.push({ path, content, patch, lines: content.split("\n").length });
  }
  return scope;
}
