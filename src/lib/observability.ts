import { logger } from "./logger";

/**
 * The single seam through which we ship errors to the tracking backend.
 * Stub for P0-10: emits a structured JSON line on stderr so aggregators and
 * a local `docker logs -f app` both see the failure. When P0-11 provisions a
 * real Sentry project and DSN, swap the body for `Sentry.captureException`
 * — the signature is deliberately Sentry-shaped so callers do not change.
 */
export interface ErrorContext {
  requestId?: string;
  tenantId?: string;
  path?: string;
  method?: string;
  [key: string]: unknown;
}

export function captureException(err: unknown, ctx: ErrorContext = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error(message, { ...ctx, err: { message, stack } });
}
