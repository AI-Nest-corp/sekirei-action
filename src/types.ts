export type Agent = "claude" | "codex";
export type ScanType = "diff" | "full";
export interface Repository { provider: "github"; host: string; id: string; full_path: string }
export interface Scope {
  scanType: ScanType;
  commit: string;
  base: string | null;
  files: { path: string; content: string; patch: string | null; lines: number }[];
  omitted: { path: string; reason: string }[];
  targets: string[];
}
export interface State {
  agent: Agent;
  model: string;
  timeout: number;
  repository: Repository;
  pr: number | null;
  scope: Scope;
  executionId: string;
  skillVersion: string;
  skillHash: string;
}
