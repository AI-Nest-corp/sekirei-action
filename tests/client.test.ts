import assert from "node:assert/strict";
import { test } from "node:test";
import { apiEndpoint, fetchSkill, sha256 } from "../src/api/client.js";

const input = { url: "https://api.example.com", key: "private-test-key", scanType: "diff" as const,
  repository: { provider: "github" as const, host: "github.com", id: "123", full_path: "owner/repo" } };
const payload = () => ({ execution_id: "b69dfae1-abcd-4abc-8abc-abcd12345678", scan_type: "diff", credits: 1,
  skill: { version: "v1", content: "review instructions", sha256: sha256("review instructions") } });
const sleep = async () => {};
test("retries a lost response with identical body and idempotency key", async () => {
  const requests: RequestInit[] = [];
  const fake = (async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    if (requests.length === 1) throw new Error("response lost after commit");
    return Response.json(payload());
  }) as typeof fetch;
  const result = await fetchSkill(input, { fetch: fake, sleep, now: Date.now });
  assert.equal(result.execution_id, payload().execution_id);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(new Headers(requests[0].headers).get("Idempotency-Key"), new Headers(requests[1].headers).get("Idempotency-Key"));
  assert.equal(requests[0].redirect, "error");
  assert.ok(!String(requests[0].body).includes(input.key));
});
for (const status of [400, 401, 402, 409]) test(`HTTP ${status} is never retried`, async () => {
  let calls = 0;
  await assert.rejects(fetchSkill(input, { fetch: (async () => { calls++; return new Response("secret server detail", { status }); }) as typeof fetch, sleep, now: Date.now }), new RegExp(`HTTP ${status}`));
  assert.equal(calls, 1);
});
test("honors Retry-After and bounds attempts", async () => {
  const waits: number[] = [];
  let calls = 0;
  await assert.rejects(fetchSkill(input, { fetch: (async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "2" } }); }) as typeof fetch,
    sleep: async (n) => { waits.push(n); }, now: Date.now }), /four attempts/);
  assert.equal(calls, 4); assert.deepEqual(waits, [2000, 2000, 2000]);
});
test("rejects corrupt skill and incorrect scan cost", async () => {
  for (const p of [{ ...payload(), credits: 3 }, { ...payload(), skill: { ...payload().skill, content: "altered" } }]) {
    await assert.rejects(fetchSkill(input, { fetch: (async () => Response.json(p)) as typeof fetch, sleep, now: Date.now }), /verification/);
  }
});
test("rejects credentials, non-HTTPS and redirect-like API origins", () => {
  for (const url of ["http://api.example.com", "https://key@api.example.com", "https://api.example.com/?x=1", "https://api.example.com/path"])
    assert.throws(() => apiEndpoint(url));
});
