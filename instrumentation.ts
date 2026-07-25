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
  }
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
