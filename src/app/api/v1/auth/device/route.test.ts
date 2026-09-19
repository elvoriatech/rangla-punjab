import { describe, expect, it } from "vitest";
import { redis } from "@/lib/redis";
import { POST } from "./route";

/**
 * The app's login entry. What matters here is the return deep link: it is
 * parked with the device code (so it never travels through the OAuth
 * state), it is allow-listed to app schemes, and it never comes back out
 * in the response the app reads.
 */

// Distinct per run: the rate limiter is per-IP and its Redis buckets
// outlive the test process.
const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function post(body?: unknown): Request {
  return new Request("http://localhost:3000/api/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function parked(code: string): Promise<Record<string, unknown>> {
  const raw = await redis.get(`customer-device:${code}`);
  return JSON.parse(raw ?? "null") as Record<string, unknown>;
}

async function mint(body?: unknown): Promise<{ code: string; text: string }> {
  const res = await POST(post(body));
  expect(res.status).toBe(200);
  const text = await res.text();
  const parsed = JSON.parse(text) as { ok: boolean; code: string };
  expect(parsed.ok).toBe(true);
  return { code: parsed.code, text };
}

describe("POST /api/v1/auth/device", () => {
  it("parks the app's return deep link with the code", async () => {
    const { code } = await mint({ app: "ranglapunjab://auth-return" });
    expect(await parked(code)).toEqual({ status: "pending", app: "ranglapunjab://auth-return" });
  });

  it("accepts an Expo dev-client return link", async () => {
    const { code } = await mint({ app: "exp+rangla://auth-return" });
    expect(await parked(code)).toEqual({ status: "pending", app: "exp+rangla://auth-return" });
  });

  it("drops a return link that is not an app scheme", async () => {
    const { code } = await mint({ app: "https://evil.example.com/steal" });
    expect(await parked(code)).toEqual({ status: "pending" });
  });

  it("still works with no body at all (older app builds)", async () => {
    const { code } = await mint();
    expect(await parked(code)).toEqual({ status: "pending" });
  });

  it("never echoes the return link back to the caller", async () => {
    const { text } = await mint({ app: "ranglapunjab://auth-return" });
    expect(text).not.toContain("ranglapunjab");
    expect(text).not.toContain("auth-return");
    // The login URLs are the only thing the app needs from the response.
    const body = JSON.parse(text) as { providers: { loginUrl: string }[] };
    expect(body.providers.length).toBeGreaterThan(0);
    for (const p of body.providers) expect(p.loginUrl).toContain("device=");
  });
});
