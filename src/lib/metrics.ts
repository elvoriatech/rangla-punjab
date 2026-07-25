import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Prometheus metrics registry + named instruments. One `Registry` per
 * process; the default Node metrics (event-loop lag, GC, memory, open
 * FDs) are attached on module load. Consumers `import { metrics }` and
 * call one of the typed helpers below so label names stay consistent
 * and no route can accidentally invent a new label cardinality.
 *
 * Label cardinality note: `route` labels are always the *pattern*
 * (e.g. `/api/items/:id`), never the resolved URL, so high-cardinality
 * ids do not blow up the metrics store. Callers of `recordHttpRequest`
 * must pass the pattern, not the raw URL.
 */

export const registry = new Registry();

// Default Node process metrics — event loop lag, GC, memory, active
// handles, file descriptors. Cheap and immediately useful in a
// dashboard for saturation signals.
collectDefaultMetrics({ register: registry });

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled, labelled by route pattern and status class.",
  labelNames: ["route", "status"] as const,
  registers: [registry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds, labelled by route pattern.",
  labelNames: ["route"] as const,
  // Buckets tuned for a fast SSR app — most requests land under 500 ms,
  // long tail up to 5 s covers cold-cache renders + the AI import
  // synchronous kickoff (post-P2-14 async worker moves this earlier).
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const bullmqJobsTotal = new Counter({
  name: "bullmq_jobs_total",
  help: "BullMQ jobs processed, labelled by queue and outcome.",
  labelNames: ["queue", "outcome"] as const,
  registers: [registry],
});

const bullmqJobDurationSeconds = new Histogram({
  name: "bullmq_job_duration_seconds",
  help: "BullMQ job duration in seconds, labelled by queue.",
  labelNames: ["queue"] as const,
  // Import + extraction jobs can run 5-60s; keep buckets wider than HTTP.
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

const stripeWebhookEventsTotal = new Counter({
  name: "stripe_webhook_events_total",
  help: "Stripe webhook events received, labelled by event type and outcome.",
  labelNames: ["event", "outcome"] as const,
  registers: [registry],
});

const cdnPurgeTotal = new Counter({
  name: "cdn_purge_total",
  help: "CDN cache-tag purge attempts, labelled by outcome.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

// P2-13: mean execution time of a top-N slow query, labelled by
// `queryid` fingerprint from `pg_stat_statements`. Cardinality is
// bounded by the report's top-N (default 20); we do NOT surface raw
// query text as a label, only the stable hash Postgres already
// computed for the plan, so no user data can leak through metrics.
const pgSlowQueryMs = new Gauge({
  name: "pg_slow_query_ms",
  help: "Mean execution time (ms) of a top-N slow query, labelled by pg_stat_statements fingerprint.",
  labelNames: ["fingerprint"] as const,
  registers: [registry],
});

// ---- Typed helpers ----------------------------------------------------

export function recordHttpRequest(input: {
  route: string;
  status: number;
  durationSeconds: number;
}): void {
  const statusClass = `${Math.floor(input.status / 100)}xx`;
  httpRequestsTotal.inc({ route: input.route, status: statusClass });
  httpRequestDurationSeconds.observe({ route: input.route }, input.durationSeconds);
}

export type BullmqJobOutcome = "completed" | "failed" | "retried";

export function recordBullmqJob(input: {
  queue: string;
  outcome: BullmqJobOutcome;
  durationSeconds: number;
}): void {
  bullmqJobsTotal.inc({ queue: input.queue, outcome: input.outcome });
  bullmqJobDurationSeconds.observe({ queue: input.queue }, input.durationSeconds);
}

export type StripeWebhookOutcome = "handled" | "ignored" | "replay" | "error";

export function recordStripeWebhookEvent(input: {
  event: string;
  outcome: StripeWebhookOutcome;
}): void {
  stripeWebhookEventsTotal.inc({ event: input.event, outcome: input.outcome });
}

export type CdnPurgeOutcome = "success" | "failure";

export function recordCdnPurge(outcome: CdnPurgeOutcome): void {
  cdnPurgeTotal.inc({ outcome });
}

export function setSlowQueryGauge(input: { fingerprint: string; meanMs: number }): void {
  pgSlowQueryMs.set({ fingerprint: input.fingerprint }, input.meanMs);
}

/** Drop every sample currently stored in the `pg_slow_query_ms` gauge —
 * used at the start of each report run so a fingerprint that fell out
 * of the top-N does not linger with a stale value. */
export function resetSlowQueryGauge(): void {
  pgSlowQueryMs.reset();
}

/**
 * Serialise the whole registry to the Prometheus text format. The
 * `/api/internal/metrics` handler streams this back verbatim.
 */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return {
    contentType: registry.contentType,
    body: await registry.metrics(),
  };
}
