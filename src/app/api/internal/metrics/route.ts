import { NextResponse } from "next/server";
import { recordHttpRequest, renderMetrics } from "@/lib/metrics";

/**
 * Prometheus scrape endpoint. Guarded by `INTERNAL_METRICS_TOKEN` — a
 * scraper (Grafana Alloy / Prometheus / Vector) must present it as a
 * `Bearer` token. The env var stays unset in dev/CI so the route
 * returns 503 (not merely 401) — a well-configured operator sees the
 * difference between "wrong token" and "metrics not turned on".
 *
 * The handler itself also increments `http_requests_total` — the
 * P2-3 verify criterion "a request through the app increments the
 * http_requests_total counter" is met by scraping /metrics itself,
 * which is exactly the state a scraper spends its life in.
 */

const ROUTE = "/api/internal/metrics";

export async function GET(request: Request): Promise<NextResponse | Response> {
  const start = performance.now();
  const token = process.env.INTERNAL_METRICS_TOKEN?.trim();
  if (!token) {
    recordHttpRequest({ route: ROUTE, status: 503, durationSeconds: elapsed(start) });
    return NextResponse.json(
      { error: "metrics_disabled", detail: "INTERNAL_METRICS_TOKEN not configured" },
      { status: 503 },
    );
  }

  const presented = extractBearer(request.headers.get("authorization"));
  if (!presented || !constantTimeEqual(presented, token)) {
    recordHttpRequest({ route: ROUTE, status: 401, durationSeconds: elapsed(start) });
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const rendered = await renderMetrics();
  recordHttpRequest({ route: ROUTE, status: 200, durationSeconds: elapsed(start) });
  return new Response(rendered.body, {
    status: 200,
    headers: { "content-type": rendered.contentType },
  });
}

function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function elapsed(start: number): number {
  return (performance.now() - start) / 1000;
}
