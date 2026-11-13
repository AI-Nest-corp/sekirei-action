import { z } from "zod";
import type { State } from "../types.js";

const text = z.string().max(6000);
export const reportSchema = z.strictObject({
  summary: text,
  unreviewed: z.array(z.strictObject({ file: z.string().min(1).max(1000), reason: text })).max(200),
  limitations: z.array(text).max(200),
  findings: z.array(z.strictObject({
    severity: z.enum(["Critical", "High", "Medium", "Low"]),
    title: z.string().min(1).max(200), file: z.string().min(1).max(1000), line: z.number().int().min(1),
    evidence: text, impact: text, remediation: text, verification: text,
    asvs: z.string().regex(/^V\d+\.\d+\.\d+$/).nullable(),
  })).max(50),
});
export const jsonSchema = z.toJSONSchema(reportSchema, { target: "draft-7" });
export function validateReport(raw: unknown, state: State, skill: string) {
  const result = reportSchema.safeParse(raw);
  if (!result.success) throw new Error("AI output does not match the report format.");
  const report = result.data;
  const serialized = JSON.stringify(report);
  // Output examples and shared headings are expected to recur in a report.
  // Only reject the complete skill or actual prose instructions before the template.
  const instructionLines = skill.split(/^## 出力形式/m)[0].split("\n");
  const leaked = instructionLines.findIndex((line) => line.startsWith("- ") && line.length >= 40 && serialized.includes(line.trim()));
  if ((skill.trim().length >= 24 && serialized.includes(skill.trim())) || leaked >= 0)
    throw new Error(`AI output contains skill instructions; report withheld (instruction ${leaked + 1}).`);
  for (const finding of report.findings) {
    const file = state.scope.files.find((file) => file.path === finding.file);
    if (!file || finding.line > file.lines) throw new Error("AI finding references a location outside the supplied source.");
  }
  for (const item of report.unreviewed) {
    if (!state.scope.files.some((file) => file.path === item.file))
      throw new Error("Unreviewed source must name a supplied file. Exclusions belong in limitations.");
  }
  const reasons = incompleteReasons(state, report);
  return { ...report, review_status: reasons.length ? "incomplete" as const : "complete" as const };
}
export function incompleteReasons(state: State, report: z.infer<typeof reportSchema>): string[] {
  const reasons = state.scope.omitted
    .filter((entry) => !entry.reason.startsWith("excluded-") && state.scope.targets.includes(entry.path))
    .map((entry) => `${entry.path}: ${entry.reason}`);
  return [...reasons, ...report.unreviewed.map((entry) => `${entry.file}: ${entry.reason}`)];
}
export function incompleteMessage(state: State, report: z.infer<typeof reportSchema>): string {
  const reasons = incompleteReasons(state, report);
  const short = reasons.slice(0, 3).map((reason) => redact(reason).replace(/[\r\n]/g, " ").slice(0, 250));
  return `Review incomplete: ${short.join("; ")}${reasons.length > 3 ? `; and ${reasons.length - 3} more` : ""}. See the job summary for details.`;
}
export function redact(text: string): string {
  return text
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|skr_[A-Za-z0-9_-]{16,})\b/g, "[REDACTED]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
}
const escape = (s: string) => redact(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "&#64;").replace(/[\\`*_\[\]{}()|#!]/g, "\\$&");
export function markdown(state: State, report: ReturnType<typeof validateReport>): string {
  const parts = ["# Sekirei security review", "", `対象: ${escape(state.repository.full_path)} · ${state.scope.commit} · ${state.scope.scanType}`,
    `解析状態: ${report.review_status === "complete" ? "完了（記載した範囲）" : "一部完了"}`, `配布ID: ${state.executionId}`, "", escape(report.summary), "", "## 指摘一覧", ""];
  if (!report.findings.length) parts.push("確認した範囲では、対応が必要な指摘はありません。");
  else {
    parts.push("| ID | 重要度 | 問題 | 対象 |", "| --- | --- | --- | --- |");
    report.findings.forEach((f, i) => parts.push(`| F-${String(i + 1).padStart(3, "0")} | ${f.severity} | ${escape(f.title).replace(/\n/g, " ")} | ${escape(f.file)}:${f.line} |`));
    report.findings.forEach((f, i) => parts.push("", `## F-${String(i + 1).padStart(3, "0")}: ${escape(f.title)}`, "",
      `- 問題と根拠: ${escape(f.evidence)}`, `- 影響: ${escape(f.impact)}`, `- 修正案: ${escape(f.remediation)}`,
      `- 確認方法（未実施）: ${escape(f.verification)}`, `- 関連基準: ${f.asvs ? `[ASVS 5.0.0 ${f.asvs}](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en)` : "未特定"}`));
  }
  parts.push("", "## 未確認の対象コード", "", ...(report.unreviewed.length ? report.unreviewed.map((x) => `- ${escape(x.file)}: ${escape(x.reason)}`) : ["なし"]),
    "", "## 確認範囲の制約・除外", "", ...report.limitations.map((x) => `- ${escape(x)}`),
    ...state.scope.omitted.map((x) => `- ${escape(x.path)}: ${x.reason}`),
    "", "静的レビューの結果です。実行による検証やASVSへの適合を保証するものではありません。", "");
  return parts.join("\n");
}
export function commentBody(markdown: string): string {
  const marker = "<!-- sekirei-security-review -->\n";
  const limit = 55_000;
  if (Buffer.byteLength(markdown) <= limit) return marker + markdown;
  const truncated = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.from(markdown).subarray(0, limit)).replace(/\uFFFD$/, "");
  return marker + truncated + "\n\n※ 長文のため省略しました。完全なレポートはこの実行のSekirei artifactを確認してください。";
}
