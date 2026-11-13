import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectScope, git } from "../src/scan/scope.js";
function repo(t: { after: (fn: () => void) => void }) {
  const cwd = mkdtempSync(join(tmpdir(), "sekirei-git-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.name", "Test"]); git(cwd, ["config", "user.email", "test@example.invalid"]);
  const commit = () => { git(cwd, ["add", "."]); git(cwd, ["commit", "-m", "test"]); return git(cwd, ["rev-parse", "HEAD"]).toString().trim(); };
  return { cwd, commit };
}
test("diff uses merge-base and handles deleted and renamed files", (t) => {
  const { cwd, commit } = repo(t);
  writeFileSync(join(cwd, "old.ts"), "export const a = 1;\n");
  writeFileSync(join(cwd, "delete.ts"), "export const b = 2;\n");
  const base = commit();
  renameSync(join(cwd, "old.ts"), join(cwd, "new.ts")); rmSync(join(cwd, "delete.ts"));
  const head = commit();
  const scope = collectScope(cwd, "diff", head, base);
  assert.equal(scope.base, base);
  assert.ok(scope.targets.includes("old.ts")); assert.ok(scope.targets.includes("new.ts")); assert.ok(scope.targets.includes("delete.ts"));
  assert.ok(scope.files.find((f) => f.path === "delete.ts")?.content.includes("b = 2"));
});
test("reads committed content, ignores symlinks and generated files, records size limits", (t) => {
  const { cwd, commit } = repo(t);
  writeFileSync(join(cwd, "src.ts"), "committed\n");
  writeFileSync(join(cwd, "big.ts"), "x".repeat(50 * 1024));
  symlinkSync("/etc/passwd", join(cwd, "link"));
  mkdirSync(join(cwd, "dist")); writeFileSync(join(cwd, "dist/bundle.js"), "generated");
  const head = commit(); writeFileSync(join(cwd, "src.ts"), "dirty working file");
  const scope = collectScope(cwd, "full", head, null);
  assert.equal(scope.files[0].content, "committed\n");
  assert.ok(scope.omitted.some((f) => f.path === "link" && f.reason.includes("symlink")));
  assert.ok(scope.omitted.some((f) => f.path === "big.ts" && f.reason === "file-size-limit"));
  assert.ok(scope.omitted.some((f) => f.path === "dist/bundle.js"));
  assert.throws(() => collectScope(cwd, "full", "a".repeat(40), null), /Checkout/);
});
