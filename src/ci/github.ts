import { readBounded } from "../api/client.js";
import type { Repository } from "../types.js";

export async function publishComment(repository: Repository, pr: number, body: string, token: string, apiUrl: string) {
  const api = new URL(apiUrl);
  if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash) throw new Error("Invalid GitHub API URL.");
  const path = repository.full_path.split("/").map(encodeURIComponent).join("/");
  const url = `${api.origin}${api.pathname.replace(/\/$/, "")}/repos/${path}/issues/${pr}/comments`;
  // A POST is intentionally not retried: a lost response could create duplicate comments.
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`PR comment failed (HTTP ${response.status}); retrieve the artifact for the report.`); }
  await readBounded(response, 1024 * 1024);
}
