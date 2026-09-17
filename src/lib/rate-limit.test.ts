import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { redis } from "./redis";
import {
  checkRateLimit,
  resetLocalRateLimitState,
  type RateLimitConfig,
  LOGIN_IP,
  LOGIN_EMAIL,
  RESET_IP,
  RESET_EMAIL,
  SIGNUP_IP,
  ORDER_IP,
} from "./rate-limit";

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

/**
 * Redis-outage behaviour. The limiter is the first statement in
 * POST /api/orders and both pay routes, so what it does when Redis is
 * unreachable decides whether guests can still order.
 */
describe("checkRateLimit when Redis is unreachable", () => {
  const scopeSuffix = () => `t-${randomUUID().slice(0, 8)}`;

  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalRateLimitState();
  });

  function breakRedis(): void {
    vi.spyOn(redis, "incr").mockRejectedValue(new Error("ECONNREFUSED"));
  }

  it("refuses by default — auth flows stay fail-closed", async () => {
    breakRedis();
    const cfg: RateLimitConfig = { scope: `login:ip:${scopeSuffix()}`, limit: 5, windowSec: 60 };

    const r = await checkRateLimit(cfg, "1.1.1.1");
    expect(r.ok).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.retryAfter).toBe(60);
  });

  it("keeps the real auth configs fail-closed", async () => {
    breakRedis();
    for (const cfg of [LOGIN_IP, LOGIN_EMAIL, RESET_IP, RESET_EMAIL, SIGNUP_IP]) {
      const r = await checkRateLimit(cfg, "1.1.1.1");
      expect(r.ok, `${cfg.scope} must fail closed`).toBe(false);
    }
  });

  it("keeps guests ordering when failOpen is set", async () => {
    breakRedis();
    const r = await checkRateLimit(ORDER_IP, "2.2.2.2");
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it("still enforces the ceiling from the in-process fallback", async () => {
    breakRedis();
    const id = "3.3.3.3";
    // ORDER_IP is 10/min: ten through, the eleventh refused — the outage
    // must not turn the limiter into an open door.
    for (let i = 1; i <= ORDER_IP.limit; i += 1) {
      const r = await checkRateLimit(ORDER_IP, id);
      expect(r.ok, `request ${i} should pass`).toBe(true);
      expect(r.count).toBe(i);
    }
    const over = await checkRateLimit(ORDER_IP, id);
    expect(over.ok).toBe(false);
    expect(over.count).toBe(ORDER_IP.limit + 1);
    expect(over.retryAfter).toBeGreaterThan(0);
  });

  it("counts each identifier separately in the fallback", async () => {
    breakRedis();
    for (let i = 0; i < ORDER_IP.limit; i += 1) await checkRateLimit(ORDER_IP, "4.4.4.4");
    expect((await checkRateLimit(ORDER_IP, "4.4.4.4")).ok).toBe(false);
    // A different guest is unaffected.
    expect((await checkRateLimit(ORDER_IP, "5.5.5.5")).ok).toBe(true);
  });

  it("recovers the moment Redis comes back", async () => {
    breakRedis();
    expect((await checkRateLimit(ORDER_IP, "6.6.6.6")).degraded).toBe(true);

    // A healthy Redis is mocked rather than reconnected: the suite above
    // already called redis.quit(), so the shared client is closed for
    // the rest of the file.
    vi.spyOn(redis, "incr").mockResolvedValue(3);
    vi.spyOn(redis, "expire").mockResolvedValue(1);

    const back = await checkRateLimit(ORDER_IP, "6.6.6.6");
    expect(back.ok).toBe(true);
    expect(back.count).toBe(3);
    // No longer degraded — the verdict came from Redis, and the local
    // fallback count (1, from the call above) was not reused.
    expect(back.degraded).toBeUndefined();
  });

  it("gives up on a hanging Redis fast instead of blocking the guest", async () => {
    // ioredis retries 3x before rejecting, so an unreachable Redis used
    // to cost ~8 s per request — measured on the real order path. The
    // limiter must bail out in a fraction of that.
    vi.spyOn(redis, "incr").mockImplementation(
      () => new Promise(() => {}) as unknown as ReturnType<typeof redis.incr>,
    );

    const started = Date.now();
    const r = await checkRateLimit(ORDER_IP, "8.8.8.8");
    const elapsed = Date.now() - started;

    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
    // Default budget is 250 ms; allow slack for a loaded CI box but stay
    // an order of magnitude below the old 8 s.
    expect(elapsed).toBeLessThan(2000);
  });

  it("rolls the fallback window over on the next bucket", async () => {
    breakRedis();
    const start = Date.parse("2026-09-17T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const cfg: RateLimitConfig = {
      scope: `order:ip:${scopeSuffix()}`,
      limit: 2,
      windowSec: 60,
      failOpen: true,
    };
    const id = "7.7.7.7";

    expect((await checkRateLimit(cfg, id)).ok).toBe(true);
    expect((await checkRateLimit(cfg, id)).ok).toBe(true);
    expect((await checkRateLimit(cfg, id)).ok).toBe(false);

    vi.setSystemTime(start + 61 * 1000);
    const after = await checkRateLimit(cfg, id);
    expect(after.ok).toBe(true);
    expect(after.count).toBe(1);
    vi.useRealTimers();
  });
});
