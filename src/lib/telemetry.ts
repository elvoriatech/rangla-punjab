import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import type { Context } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/sdk-trace-base";
import { getRequestContext } from "./logger";

/**
 * OpenTelemetry SDK boot. Guarded by `OTEL_EXPORTER_OTLP_ENDPOINT` so
 * dev/CI stay silent — nothing tries to reach an endpoint that isn't
 * running. `startOtel()` returns `null` when the env is unset, so
 * `instrumentation.ts` can call it unconditionally without adding a
 * network dependency to the test suite.
 *
 * Vendor decision (2026-07-13, CLAUDE.md): Grafana Cloud (traces +
 * metrics) + Sentry EU (errors), OTLP-emitted so the vendor stays
 * swappable. Auto-instrumentation covers `http`, `pg`, and `ioredis`;
 * BullMQ is transitively covered because its wire protocol is Redis
 * commands. A dedicated `bullmq` instrumentation package would be a
 * follow-up if the ioredis coverage misses job-level attributes.
 *
 * The `EnrichmentSpanProcessor` stamps `tenant.id` and `http.route`
 * onto every span from the `runWithRequestContext` ALS (P2-1), so an
 * incoming request's spans are searchable by tenant even when the
 * span comes from a nested library that has no idea about our
 * request-context concept.
 */

export interface OtelHandle {
  shutdown: () => Promise<void>;
}

export interface StartOtelOptions {
  /** Override endpoint (mostly for tests). Falls back to env. */
  endpoint?: string;
  /** Inject a `SpanExporter` to bypass OTLP (used in vitest). */
  traceExporter?: SpanExporter;
  /** Skip auto-instrumentations (tests don't need `http` monkey-patching). */
  skipInstrumentations?: boolean;
}

export function startOtel(opts: StartOtelOptions = {}): OtelHandle | null {
  const endpoint = opts.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint && !opts.traceExporter) return null;

  const traceExporter =
    opts.traceExporter ??
    new OTLPTraceExporter({ url: `${endpoint!.replace(/\/$/, "")}/v1/traces` });

  // Tests use SimpleSpanProcessor so `export` fires synchronously on
  // `span.end()`; production uses BatchSpanProcessor for throughput.
  const spanProcessor: SpanProcessor = opts.traceExporter
    ? new SimpleSpanProcessor(traceExporter)
    : new BatchSpanProcessor(traceExporter);

  const sdk = new NodeSDK({
    serviceName: "guesto",
    spanProcessors: [new EnrichmentSpanProcessor(), spanProcessor],
    instrumentations: opts.skipInstrumentations
      ? []
      : [new HttpInstrumentation(), new PgInstrumentation(), new IORedisInstrumentation()],
  });

  sdk.start();

  return {
    shutdown: () => sdk.shutdown(),
  };
}

/**
 * SpanProcessor that reads the request context from ALS and stamps
 * `tenant.id` + `http.route` onto every span as it starts. Purely a
 * decorator — it does not export or filter.
 */
export class EnrichmentSpanProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    void _parentContext;
    const { tenantId, route, userId } = getRequestContext();
    if (tenantId) span.setAttribute("tenant.id", tenantId);
    if (route) span.setAttribute("http.route", route);
    if (userId) span.setAttribute("enduser.id", userId);
  }

  onEnd(_span: ReadableSpan): void {
    void _span;
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
