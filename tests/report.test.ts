import assert from "node:assert/strict";
import { test } from "node:test";
import { commentBody, markdown, redact, validateReport } from "../src/report/index.js";
import type { State } from "../src/types.js";
const state: State = { agent: "claude", model: "", timeout: 10, repository: { provider: "github", host: "github.com", id: "1", full_path: "owner/repo" }, pr: 1,
  executionId: "test", skillVersion: "v1", skillHash: "hash", scope: { scanType: "diff", commit: "a".repeat(40), base: "b".repeat(40), targets: ["x.ts"], omitted: [], files: [{ path: "x.ts", lines: 10, content: "test", patch: "test" }] } };
const report = () => ({ review_status: "complete", summary: "Summary", unreviewed: [], findings: [{ severity: "High", title: "<img src=x> @everyone", file: "x.ts", line: 2, evidence: "Input reaches SQL", impact: "Data disclosure", remediation: "Bind parameters", verification: "Check bad input", asvs: null }] });
test("validates locations and escapes Markdown/HTML/mentions", () => {
  const result = validateReport(report(), state, "private instructions");
  const md = markdown(state, result);
  assert.ok(!md.includes("<img")); assert.ok(!md.includes("@everyone"));
  assert.ok(md.includes("F-001"));
  assert.throws(() => validateReport({ ...report(), findings: [{ ...report().findings[0], file: "elsewhere.ts" }] }, state, ""), /outside/);
  assert.throws(() => validateReport({ ...report(), findings: [{ ...report().findings[0], line: 99 }] }, state, ""), /outside/);
});
test("missing coverage cannot be represented as complete", () => {
  const limited = { ...state, scope: { ...state.scope, omitted: [{ path: "huge.ts", reason: "file-size-limit" }] } };
  assert.equal(validateReport(report(), limited, "").review_status, "incomplete");
});
test("withholds instructions and redacts credential values", () => {
  const skill = "Private review instructions that must never be published.";
  assert.throws(() => validateReport({ ...report(), summary: skill }, state, skill), /withheld/);
  assert.equal(redact("sk-" + "x".repeat(32)), "[REDACTED]");
});
test("truncates comments with an explicit artifact notice", () => {
  const comment = commentBody("日本語".repeat(30_000));
  assert.ok(Buffer.byteLength(comment) < 60_000); assert.ok(comment.includes("artifact")); assert.ok(!comment.includes("�"));
});
