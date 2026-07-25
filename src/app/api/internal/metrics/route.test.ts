import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordBullmqJob,
  recordCdnPurge,
  recordHttpRequest,
  recordStripeWebhookEvent,
  registry,
} from "@/lib/metrics";
import { GET } from "./route";

const REQUIRED_METRIC_NAMES = [
  "http_requests_total",
  "http_request_duration_seconds",
  "bullmq_jobs_total",
  "bullmq_job_duration_seconds",
  "stripe_webhook_events_total",
  "cdn_purge_total",
] as const;

describe("/api/internal/metrics (P2-3)", () => {
  const originalToken = process.env.INTERNAL_METRICS_TOKEN;

  beforeEach(() => {
    registry.resetMetrics();
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.INTERNAL_METRICS_TOKEN;
    else process.env.INTERNAL_METRICS_TOKEN = originalToken;
  });

  function request(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost:3000/api/internal/metrics", { headers });
  }

  it("returns 503 when INTERNAL_METRICS_TOKEN is not configured (metrics disabled)", async () => {
    delete process.env.INTERNAL_METRICS_TOKEN;
    const res = await GET(request({ authorization: "Bearer anything" }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("metrics_disabled");
  });

  it("returns 401 when the token is missing", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "dev-metrics-token";
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is wrong", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "dev-metrics-token";
    const res = await GET(request({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
  });

  it("returns Prometheus text-format containing every named metric on a valid token", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "dev-metrics-token";
    // Emit each metric at least once so it appears in the output.
    recordHttpRequest({ route: "/api/items", status: 200, durationSeconds: 0.05 });
    recordBullmqJob({ queue: "slow-query-report", outcome: "completed", durationSeconds: 1.2 });
    recordStripeWebhookEvent({ event: "checkout.session.completed", outcome: "handled" });
    recordCdnPurge("success");

    const res = await GET(request({ authorization: "Bearer dev-metrics-token" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    for (const name of REQUIRED_METRIC_NAMES) {
      expect(body, `metric ${name} missing`).toContain(name);
    }
    // Confirm at least one Node default metric is exposed alongside our
    // custom counters — proves collectDefaultMetrics() ran.
    expect(body).toContain("process_cpu_user_seconds_total");
  });

  it("a request through the app increments http_requests_total", async () => {
    process.env.INTERNAL_METRICS_TOKEN = "dev-metrics-token";
    // First scrape — grab the current counter value.
    const first = await GET(request({ authorization: "Bearer dev-metrics-token" }));
    expect(first.status).toBe(200);
    const before = extractCounter(await first.text(), "http_requests_total");

    // Second scrape — a bona-fide request through the handler; the
    // handler itself bumps `http_requests_total{route,status}`.
    const second = await GET(request({ authorization: "Bearer dev-metrics-token" }));
    expect(second.status).toBe(200);
    const after = extractCounter(await second.text(), "http_requests_total");

    // Between the two scrapes, at least one more `http_requests_total`
    // sample was added (the first GET itself). Sum across all labels
    // because prom-client emits one line per label combination.
    expect(after).toBeGreaterThan(before);
  });
});

function extractCounter(prom: string, name: string): number {
  return prom
    .split("\n")
    .filter((line) => line.startsWith(name + "{") || line === name)
    .map((line) => Number(line.split(/\s+/).at(-1)))
    .filter((n) => Number.isFinite(n))
    .reduce((sum, n) => sum + n, 0);
}
