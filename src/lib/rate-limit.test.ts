import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { redis } from "./redis";
import { checkRateLimit, type RateLimitConfig } from "./rate-limit";

// Integration test: exercises the real Redis service (docker-compose or CI
// service). Each test uses a fresh scope-fragment so parallel tests do not
// collide, and cleans up its own keys.

describe("checkRateLimit", () => {
  const scopeSuffix = () => `t-${randomUUID().slice(0, 8)}`;

  afterEach(async () => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("permits up to the limit, then rejects with Retry-After", async () => {
    const cfg: RateLimitConfig = { scope: `login:ip:${scopeSuffix()}`, limit: 5, windowSec: 60 };
    const id = "1.2.3.4";

    for (let i = 1; i <= 5; i++) {
      const r = await checkRateLimit(cfg, id);
      expect(r.ok).toBe(true);
      expect(r.count).toBe(i);
    }
    const sixth = await checkRateLimit(cfg, id);
    expect(sixth.ok).toBe(false);
    expect(sixth.count).toBe(6);
    expect(sixth.retryAfter).toBeGreaterThan(0);
    expect(sixth.retryAfter).toBeLessThanOrEqual(60);
  });

  it("counts email caps independently of IP caps", async () => {
    const scope = `login:email:${scopeSuffix()}`;
    const cfg: RateLimitConfig = { scope, limit: 10, windowSec: 3600 };
    const email = `alice-${randomUUID()}@ex.com`;

    // Hit the email cap 10 times — should all pass.
    for (let i = 0; i < 10; i++) {
      const r = await checkRateLimit(cfg, email);
      expect(r.ok).toBe(true);
    }
    // Same email, "different IP" doesn't matter — the config is keyed by
    // email — 11th call trips regardless.
    const eleventh = await checkRateLimit(cfg, email);
    expect(eleventh.ok).toBe(false);
    expect(eleventh.retryAfter).toBeGreaterThan(0);
  });

  it("counter resets when the window bucket rolls over", async () => {
    // Fake time so we can advance past a bucket boundary without waiting.
    const start = Date.parse("2026-07-12T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);

    const cfg: RateLimitConfig = {
      scope: `login:ip:${scopeSuffix()}`,
      limit: 2,
      windowSec: 60,
    };
    const id = "9.9.9.9";

    expect((await checkRateLimit(cfg, id)).ok).toBe(true); // 1
    expect((await checkRateLimit(cfg, id)).ok).toBe(true); // 2
    expect((await checkRateLimit(cfg, id)).ok).toBe(false); // 3 — over

    // Advance past the bucket boundary; the key name changes, count starts
    // fresh at 1. The old key still exists in Redis until its EXPIRE fires,
    // but we never touch it again.
    vi.setSystemTime(start + 61 * 1000);
    const after = await checkRateLimit(cfg, id);
    expect(after.ok).toBe(true);
    expect(after.count).toBe(1);
  });
});
