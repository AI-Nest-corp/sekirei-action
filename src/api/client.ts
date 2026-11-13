import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Repository, ScanType } from "../types.js";

export const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");
export function apiEndpoint(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("api-url must be an HTTPS origin without credentials, path, query or fragment.");
  return new URL("/v1/skill-distributions", url);
}
const distribution = z.object({
  execution_id: z.uuid(), scan_type: z.enum(["diff", "full"]), credits: z.number().int(),
  skill: z.object({ version: z.string().min(1).max(64), sha256: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().min(1) }),
});
export async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new Error("Missing response body.");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Response exceeds size limit.");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await reader.cancel().catch(() => {}); }
}
export async function fetchSkill(
  input: { url: string; key: string; scanType: ScanType; repository: Repository },
  deps = { fetch: globalThis.fetch, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now: Date.now },
) {
  const endpoint = apiEndpoint(input.url);
  const idempotencyKey = randomUUID();
  const body = JSON.stringify({ scan_type: input.scanType, repository: input.repository });
  for (let attempt = 0; attempt < 4; attempt++) {
    let retryAfter = 1000 * 2 ** attempt;
    try {
      const response = await deps.fetch(endpoint, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${input.key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body,
      });
      if (response.ok) {
        const content = await readBounded(response, 2 * 1024 * 1024);
        let result: z.infer<typeof distribution>;
        try { result = distribution.parse(JSON.parse(content)); }
        catch { throw new FatalError("Invalid skill response."); }
        if (result.scan_type !== input.scanType || result.credits !== (input.scanType === "diff" ? 1 : 3) ||
          Buffer.byteLength(result.skill.content) > 256 * 1024 || sha256(result.skill.content) !== result.skill.sha256)
          throw new FatalError("Skill response or SHA-256 verification failed.");
        return result;
      }
      await response.body?.cancel();
      if (response.status !== 429 && ![500, 502, 503, 504].includes(response.status))
        throw new FatalError(`Skill distribution failed (HTTP ${response.status}).`);
      const header = response.headers.get("retry-after");
      if (header) {
        const wait = /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - deps.now();
        if (Number.isFinite(wait)) retryAfter = Math.max(0, wait);
      }
      if (retryAfter > 30_000) throw new FatalError("Server requested a retry beyond the retry budget.");
    } catch (error) { if (error instanceof FatalError) throw error; }
    if (attempt < 3) await deps.sleep(retryAfter);
  }
  throw new Error("Skill distribution did not complete after four attempts. Check the usage history before rerunning.");
}
class FatalError extends Error {}
