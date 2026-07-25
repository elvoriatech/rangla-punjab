import { redis } from "./redis";

/**
 * Bucket-keyed fixed-window rate limiter. Every request maps to a Redis key
 * of the form `rl:{scope}:{identifier}:{bucket}` where `bucket = floor(now
 * / windowSec)` — advancing past a window boundary yields a new key, so
 * "counters reset after TTL" is automatic and clock-driven, not TTL-driven.
 * Redis EXPIRE just cleans up the stale keys.
 *
 * We deliberately keep this dumb (no sliding window, no token bucket): the
 * rate-limit ceilings on login (5/min per IP, 10/hr per email) and reset
 * (3/hr per IP, 3/hr per email) tolerate the ±1 imprecision at bucket
 * boundaries. Anything more precise is optimising for the wrong problem.
 */

export interface RateLimitConfig {
  /** Namespace fragment, e.g. "login:ip". */
  scope: string;
  /** Requests allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Current count in this window (post-increment). */
  count: number;
  /** Seconds until the current bucket rolls over. */
  retryAfter: number;
}

export async function checkRateLimit(
  cfg: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / cfg.windowSec);
  const bucketEnd = (bucket + 1) * cfg.windowSec;
  const key = `rl:${cfg.scope}:${identifier}:${bucket}`;

  const count = await redis.incr(key);
  if (count === 1) {
    // Only the first hit inside a bucket sets the TTL — later hits reuse
    // the same key. `EXPIRE` on an already-expiring key is a no-op with
    // NX, which we don't need since count===1 is exclusive.
    await redis.expire(key, cfg.windowSec);
  }

  return { ok: count <= cfg.limit, count, retryAfter: bucketEnd - nowSec };
}

// ---- Concrete configs used by the auth routes ----

export const LOGIN_IP: RateLimitConfig = { scope: "login:ip", limit: 5, windowSec: 60 };
export const LOGIN_EMAIL: RateLimitConfig = { scope: "login:email", limit: 10, windowSec: 3600 };
export const RESET_IP: RateLimitConfig = { scope: "reset:ip", limit: 3, windowSec: 3600 };
export const SIGNUP_IP: RateLimitConfig = { scope: "signup:ip", limit: 5, windowSec: 3600 };
// Guest orders are anonymous — per-IP is the only handle we have. 10/min
// absorbs a large table ordering in rounds while blunting scripted spam.
export const ORDER_IP: RateLimitConfig = { scope: "order:ip", limit: 10, windowSec: 60 };
export const RESET_EMAIL: RateLimitConfig = { scope: "reset:email", limit: 3, windowSec: 3600 };
