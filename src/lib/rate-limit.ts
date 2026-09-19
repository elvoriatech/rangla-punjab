import { redis } from "./redis";
import { createLogger } from "./logger";

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

const log = createLogger();

export interface RateLimitConfig {
  /** Namespace fragment, e.g. "login:ip". */
  scope: string;
  /** Requests allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /**
   * What to do when Redis is unreachable. Default (false) refuses the
   * request — right for auth, where blocking is the safe failure. Set
   * true for guest-facing flows that must keep working through a Redis
   * blip; those fall back to an in-process counter, so they stay rate
   * limited rather than becoming unlimited.
   */
  failOpen?: boolean;
}

export interface RateLimitResult {
  ok: boolean;
  /** Current count in this window (post-increment). */
  count: number;
  /** Seconds until the current bucket rolls over. */
  retryAfter: number;
  /** True when this verdict came from the fallback, not Redis. */
  degraded?: boolean;
}

/**
 * In-process fallback counters, used only while Redis is unreachable.
 *
 * One app container serves this deploy, so an in-memory counter is a
 * complete view of traffic for the outage window — "fail open" therefore
 * still means "rate limited", just from local state instead of Redis.
 * Entries are keyed with their bucket, so a stale one can only ever
 * over-count within one window; the sweep below bounds memory.
 *
 * Cached on `globalThis` for the same reason `redis.ts` caches its
 * client: Next re-evaluates server modules on HMR, so a plain
 * module-level Map is silently reset between requests in dev — the
 * counter would never reach its ceiling and the fallback would look
 * like an open door. (Verified: with Redis stopped, a module-local Map
 * let 12 straight orders through a 10/min limit.)
 */
const globalForRateLimit = globalThis as unknown as {
  rateLimitLocalBuckets?: Map<string, { count: number; expiresAt: number }>;
};

const localBuckets = (globalForRateLimit.rateLimitLocalBuckets ??= new Map<
  string,
  { count: number; expiresAt: number }
>());

const LOCAL_SWEEP_THRESHOLD = 1000;

function sweepLocal(nowSec: number): void {
  if (localBuckets.size <= LOCAL_SWEEP_THRESHOLD) return;
  for (const [k, v] of localBuckets) {
    if (v.expiresAt <= nowSec) localBuckets.delete(k);
  }
  // Still oversized (a genuine flood of distinct IPs) — drop everything
  // rather than grow without bound. Worst case a flooder gets one extra
  // window's allowance, which beats an OOM.
  if (localBuckets.size > LOCAL_SWEEP_THRESHOLD) localBuckets.clear();
}

function checkLocal(key: string, cfg: RateLimitConfig, nowSec: number, bucketEnd: number) {
  sweepLocal(nowSec);
  const existing = localBuckets.get(key);
  const count = existing && existing.expiresAt > nowSec ? existing.count + 1 : 1;
  localBuckets.set(key, { count, expiresAt: bucketEnd });
  return { ok: count <= cfg.limit, count, retryAfter: bucketEnd - nowSec, degraded: true };
}

/** Test seam: drop the in-process fallback state. */
export function resetLocalRateLimitState(): void {
  localBuckets.clear();
}

/**
 * How long a limiter check may wait on Redis before giving up.
 *
 * Without this, an unreachable Redis costs ~8 SECONDS per request:
 * ioredis retries `maxRetriesPerRequest` (3) times before its promise
 * rejects, and the limiter is the first statement on the order path — so
 * "ordering still works during a Redis outage" would have meant every
 * guest waiting 8 s for their basket to submit. Redis is local to the
 * compose network, where a healthy round-trip is sub-millisecond, so a
 * quarter second is enormous headroom and turns an outage into an
 * imperceptible blip instead of a timeout.
 */
const REDIS_TIMEOUT_MS = Number(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS ?? 250);

class RedisTimeout extends Error {
  constructor() {
    super(`rate-limit: redis did not answer in ${REDIS_TIMEOUT_MS}ms`);
  }
}

function withTimeout<T>(op: Promise<T>): Promise<T> {
  // A rejection arriving after we have already given up must not surface
  // as an unhandled rejection.
  op.catch(() => {});
  let timer: NodeJS.Timeout;
  return Promise.race([
    op,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RedisTimeout()), REDIS_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export async function checkRateLimit(
  cfg: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / cfg.windowSec);
  const bucketEnd = (bucket + 1) * cfg.windowSec;
  const key = `rl:${cfg.scope}:${identifier}:${bucket}`;

  try {
    const count = await withTimeout(redis.incr(key));
    if (count === 1) {
      // Only the first hit inside a bucket sets the TTL — later hits reuse
      // the same key. `EXPIRE` on an already-expiring key is a no-op with
      // NX, which we don't need since count===1 is exclusive.
      await withTimeout(redis.expire(key, cfg.windowSec));
    }

    return { ok: count <= cfg.limit, count, retryAfter: bucketEnd - nowSec };
  } catch (err) {
    // Redis is down, restarting, or out of memory. This used to throw
    // straight through the caller, and because the limiter is the FIRST
    // statement in POST /api/orders and both pay routes, a Redis blip
    // returned 500 to every guest trying to order or pay — the limiter
    // closed the restaurant. With no CDN or WAF in front of this deploy,
    // that made Redis the most fragile link in the revenue path.
    //
    // So each config now chooses: `failOpen` keeps guests ordering
    // (backed by the local counter above), while auth flows stay
    // fail-closed, where refusing is the safe default.
    log.warn("ratelimit.backend_unavailable", {
      scope: cfg.scope,
      failOpen: cfg.failOpen === true,
      error: err instanceof Error ? err.message : "unknown",
    });
    if (!cfg.failOpen) {
      return { ok: false, count: 0, retryAfter: cfg.windowSec, degraded: true };
    }
    return checkLocal(key, cfg, nowSec, bucketEnd);
  }
}

// ---- Concrete configs used by the auth routes ----

export const LOGIN_IP: RateLimitConfig = { scope: "login:ip", limit: 5, windowSec: 60 };
export const LOGIN_EMAIL: RateLimitConfig = { scope: "login:email", limit: 10, windowSec: 3600 };
export const RESET_IP: RateLimitConfig = { scope: "reset:ip", limit: 3, windowSec: 3600 };
export const SIGNUP_IP: RateLimitConfig = { scope: "signup:ip", limit: 5, windowSec: 3600 };
export const RESERVATION_IP: RateLimitConfig = {
  scope: "reservation:ip",
  limit: 5,
  windowSec: 3600,
};
// Reading a reservation back is a poll, not a write: the app refreshes
// the status card while a guest waits for the restaurant to call, and a
// family may have several phones open behind one restaurant IP. 60/min
// is far above that and still bounds someone spraying guessed ids at the
// route. failOpen: a Redis blip must not blank a guest's booking.
export const RESERVATION_READ_IP: RateLimitConfig = {
  scope: "reservation-read:ip",
  limit: 60,
  windowSec: 60,
  failOpen: true,
};
// Guest orders are anonymous — per-IP is the only handle we have. 10/min
// absorbs a large table ordering in rounds while blunting scripted spam.
// failOpen: a Redis outage must not stop guests ordering or paying. The
// in-process fallback keeps the same 10/min ceiling during the outage.
export const ORDER_IP: RateLimitConfig = {
  scope: "order:ip",
  limit: 10,
  windowSec: 60,
  failOpen: true,
};
// Mobile device-pairing codes. The codes themselves are ~60 bits, single
// use and expire in 10 minutes, so this is not brute-force defence — it
// bounds how many Redis keys an anonymous caller can mint. Generous
// enough that a guest retrying sign-in never notices.
export const DEVICE_IP: RateLimitConfig = {
  scope: "device:ip",
  limit: 20,
  windowSec: 3600,
  failOpen: true,
};
export const RESET_EMAIL: RateLimitConfig = { scope: "reset:email", limit: 3, windowSec: 3600 };
// The app's staff orders board polls while service is running, and a busy
// counter may have several devices open on the same restaurant IP. 120/min
// is far above that and still bounds a scraper that stole a session value.
// failOpen: a Redis blip must not blank the kitchen's board mid-service —
// the in-process fallback keeps the same ceiling during the outage.
export const STAFF_IP: RateLimitConfig = {
  scope: "staff:ip",
  limit: 120,
  windowSec: 60,
  failOpen: true,
};
// Complaint messages (P7-10). Anonymous like ordering — the receipt token
// authorizes the write, so per-IP is the only handle on someone spraying
// posts at a guessed order id. 10 per 10 minutes is far above a real
// conversation (a guest writes two or three messages, maybe with a photo)
// and well below anything that could fill the disk with normalized images.
// failOpen: a Redis blip must not stop an angry guest being heard — the
// in-process fallback keeps the same ceiling for the outage.
export const ISSUE_IP: RateLimitConfig = {
  scope: "issue:ip",
  limit: 10,
  windowSec: 600,
  failOpen: true,
};
