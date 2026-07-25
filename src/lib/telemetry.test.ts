import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { runWithRequestContext } from "./logger";
import { EnrichmentSpanProcessor, startOtel, type OtelHandle } from "./telemetry";

class CapturingExporter implements SpanExporter {
  public captured: ReadableSpan[] = [];
  export(spans: ReadableSpan[], cb: (result: { code: number; error?: Error }) => void): void {
    this.captured.push(...spans);
    cb({ code: 0 });
  }
  async shutdown(): Promise<void> {
    /* no-op */
  }
  async forceFlush(): Promise<void> {
    /* no-op */
  }
}

describe("startOtel env gate (P2-2)", () => {
  let handle: OtelHandle | null = null;
  const originalEnv = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  afterEach(async () => {
    if (handle) await handle.shutdown().catch(() => undefined);
    handle = null;
    if (originalEnv === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEnv;
  });

  it("returns null when OTEL_EXPORTER_OTLP_ENDPOINT is unset (no export attempt is possible)", () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const result = startOtel();
    expect(result).toBeNull();
  });

  it("returns null when OTEL_EXPORTER_OTLP_ENDPOINT is empty/whitespace", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "   ";
    expect(startOtel()).toBeNull();
  });
});

describe("EnrichmentSpanProcessor (P2-2)", () => {
  // Bypass the NodeSDK to avoid the "global tracer provider is set once
  // per process" problem — we test the enrichment logic in isolation by
  // wiring it to a local `BasicTracerProvider`. The startOtel-driven
  // path is exercised end-to-end by the `startOtel env gate` block
  // above; this suite proves the ALS → span-attribute enrichment.

  function buildTracer(exporter: SpanExporter): {
    tracer: ReturnType<typeof trace.getTracer>;
    provider: BasicTracerProvider;
  } {
    const provider = new BasicTracerProvider({
      spanProcessors: [new EnrichmentSpanProcessor(), new SimpleSpanProcessor(exporter)],
    });
    return { tracer: provider.getTracer("test"), provider };
  }

  it("stamps tenant.id + http.route + enduser.id from the ALS context", async () => {
    const exporter = new CapturingExporter();
    const { tracer, provider } = buildTracer(exporter);

    await runWithRequestContext(
      { tenantId: "t-otel", route: "/api/items", userId: "u-otel" },
      async () => {
        await tracer.startActiveSpan("op.nested", async (span) => {
          span.end();
        });
      },
    );

    await provider.shutdown();

    expect(exporter.captured.length).toBeGreaterThan(0);
    const span = exporter.captured.at(-1)!;
    expect(span.name).toBe("op.nested");
    expect(span.attributes["tenant.id"]).toBe("t-otel");
    expect(span.attributes["http.route"]).toBe("/api/items");
    expect(span.attributes["enduser.id"]).toBe("u-otel");
  });

  it("does not stamp tenant.id when the ALS context is empty (unbound emit)", async () => {
    const exporter = new CapturingExporter();
    const { tracer, provider } = buildTracer(exporter);

    await tracer.startActiveSpan("op.bare", async (span) => {
      span.end();
    });
    await provider.shutdown();

    expect(exporter.captured.length).toBeGreaterThan(0);
    const span = exporter.captured.at(-1)!;
    expect(span.attributes["tenant.id"]).toBeUndefined();
    expect(span.attributes["http.route"]).toBeUndefined();
    expect(span.attributes["enduser.id"]).toBeUndefined();
  });

  it("does not cross-talk between two concurrent scopes (P2-1 ALS invariant carries into spans)", async () => {
    const exporter = new CapturingExporter();
    const { tracer, provider } = buildTracer(exporter);

    async function work(id: string): Promise<void> {
      await runWithRequestContext({ tenantId: `t-${id}`, route: `/api/${id}` }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        await tracer.startActiveSpan(`op.${id}`, async (span) => {
          span.end();
        });
      });
    }
    await Promise.all([work("a"), work("b")]);
    await provider.shutdown();

    const spanA = exporter.captured.find((s) => s.name === "op.a");
    const spanB = exporter.captured.find((s) => s.name === "op.b");
    expect(spanA?.attributes["tenant.id"]).toBe("t-a");
    expect(spanA?.attributes["http.route"]).toBe("/api/a");
    expect(spanB?.attributes["tenant.id"]).toBe("t-b");
    expect(spanB?.attributes["http.route"]).toBe("/api/b");
  });
});
