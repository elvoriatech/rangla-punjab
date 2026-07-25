import Redis from "ioredis";
import { env } from "./env";

/**
 * Single Redis connection cached on `globalThis` so Next's dev-mode HMR
 * doesn't leak a new client per reload. Lazy connect so importing this
 * module in an edge context (where net sockets aren't available) doesn't
 * fail at import — callers get an error only when they actually issue a
 * command. `ioredis` handles reconnect + backoff itself.
 */
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createClient(): Redis {
  return new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    // Turn off ioredis's implicit "read-only replica" retries in Sentinel
    // mode — we run a single primary and want failures to surface fast.
    enableReadyCheck: true,
  });
}

export const redis: Redis = globalForRedis.redis ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
