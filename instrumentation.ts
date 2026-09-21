import type { Instrumentation } from "next";
import { logger } from "./src/lib/logger";
import { captureException } from "./src/lib/observability";

/**
 * Next 16 calls `register` once per server process at boot and `onRequestError`
 * for every server-side request error. Both hooks route through the same
 * observability seam (`src/lib/observability.ts`) so swapping the stub for a
 * real Sentry SDK later is a single-file change.
 *
 * P2-2 also boots the OpenTelemetry SDK from here, guarded by
 * `OTEL_EXPORTER_OTLP_ENDPOINT` — so dev + CI runs without the env var
 * see zero telemetry-related network activity. The Node instrumentation
 * (http/pg/ioredis) monkey-patches the runtime at import time; running
 * it inside `register` (which Next calls at process boot, before route
 * handlers load) is the officially-supported hook.
 */

export async function register(): Promise<void> {
  logger.info("instrumentation.register", { runtime: process.env.NEXT_RUNTIME });
  // OTel auto-instrumentation only makes sense in the Node runtime — the
  // Edge runtime has no `async_hooks` and no `http` module to patch.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startOtel } = await import("./src/lib/telemetry");
    const otel = startOtel();
    if (otel) {
      logger.info("otel.started", { endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });
      process.on("SIGTERM", () => void otel.shutdown());
    }
    startPartitionMaintenance();
    clearSavedPaymentKeysOnBoot();
  }
}

/**
 * prod.env payment keys are the only ones: saved Stripe/PayPal keys in the
 * DB are removed for every provider prod.env configures (see
 * `payment-keys-env.ts`). Once per boot; never fatal.
 */
function clearSavedPaymentKeysOnBoot(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.PAYMENT_KEYS_FROM_ENV === "0") return;
  void (async () => {
    try {
      const { clearSavedPaymentKeys } = await import("./src/lib/payment-keys-env");
      const cleared = await clearSavedPaymentKeys();
      logger.info("payment_keys.saved_keys_cleared", cleared);
    } catch (err) {
      logger.warn("payment_keys.clear_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  })();
}

/** Once a day; `aheadMonths` (3) is the real safety margin. */
const PARTITION_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * `audit_events` and `scan_stats` are monthly range-partitioned, so a
 * month with no partition makes every INSERT fail with "no partition of
 * relation found for row". The partition-maintain BullMQ queue that was
 * meant to roll them forward was never registered by anything — the
 * cron simply never ran, and the pre-created partitions stopped at
 * 2026-09. Audit writes are wrapped in a try/catch that only warns, so
 * this would have surfaced as operator actions silently going
 * unrecorded rather than as an outage.
 *
 * This deploy is one small VPS with one app container, so an in-process
 * timer is the whole scheduler it needs — no queue, no worker, no host
 * cron to forget. Boot covers the redeploy case; the daily tick covers
 * a container that stays up for months.
 *
 * Failure is never fatal: maintenance is DDL against the app's own
 * schema, and if it cannot run we would rather serve traffic and warn.
 */
function startPartitionMaintenance(): void {
  if (process.env.PARTITION_MAINTENANCE_ON_BOOT === "0") {
    logger.info("partitions.maintenance_disabled");
    return;
  }
  // `next build` imports this module to collect metadata; it must not
  // open a DB connection or run DDL at build time.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const run = async (): Promise<void> => {
    try {
      const { runPartitionMaintenance } = await import("./src/lib/partition-manager");
      const result = await runPartitionMaintenance();
      logger.info("partitions.maintained", {
        created: result.created.length,
        archived: result.archived.length,
      });
    } catch (err) {
      logger.warn("partitions.maintenance_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
    // Same tick prunes the webhook de-duplication table. Those rows only
    // need to outlive the provider's retry window (Stripe: 7 days); the
    // guard they back moved from Redis (which expired keys itself) to
    // Postgres, which does not, so something has to delete them.
    try {
      const { pruneWebhookEvents } = await import("./src/lib/webhook-events");
      const deleted = await pruneWebhookEvents();
      if (deleted > 0) logger.info("webhook_events.pruned", { deleted });
    } catch (err) {
      logger.warn("webhook_events.prune_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  };

  void run();
  // unref so a pending tick never holds the process open on shutdown.
  setInterval(() => void run(), PARTITION_MAINTENANCE_INTERVAL_MS).unref();
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  captureException(err, {
    path: request.path,
    method: request.method,
    // These headers become authoritative once tenant middleware lands
    // (P1-1); today they are best-effort.
    requestId: header(request.headers, "x-request-id"),
    tenantId: header(request.headers, "x-tenant-id"),
    routerKind: context.routerKind,
    routeType: context.routeType,
  });
};

function header(
  headers: { [key: string]: string | string[] | undefined },
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}
