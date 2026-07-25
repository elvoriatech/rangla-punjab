import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Structured JSON logger. One line = one event, `JSON.parse`-able by any log
 * aggregator. Callers pass *structured fields*, never raw user input embedded
 * in the message — see the `REDACT` allowlist below and the spec's rule
 * "logs never contain raw user text" (CLAUDE.md).
 *
 * P2-1 adds an `AsyncLocalStorage`-backed request context. Anything running
 * inside `runWithRequestContext({...}, fn)` — route handlers, BullMQ workers,
 * their transitively-called services — automatically decorates every emit
 * with the bound fields (`requestId`, `tenantId`, `userId`, `route`,
 * `method`) so a nested service call never has to receive them as parameters
 * and two concurrent requests never leak state into each other.
 */

type Level = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  route?: string;
  method?: string;
  [key: string]: unknown;
}

const requestContextStorage = new AsyncLocalStorage<LogContext>();

export function runWithRequestContext<T>(ctx: LogContext, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(requestContextStorage.run(ctx, fn));
}

export function getRequestContext(): LogContext {
  return requestContextStorage.getStore() ?? {};
}

// Keys we refuse to serialise verbatim, at any nesting depth. Additions here
// are cheap; removals should require a review.
const REDACT_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "cookie",
  "email",
  "phone",
  "secret",
  "api_key",
  "apikey",
]);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(v);
  }
  return out;
}

function emit(level: Level, msg: string, ctx: LogContext): void {
  // Merge the ALS-carried request context underneath the caller's explicit
  // fields so an explicit override wins (e.g. a service log with a different
  // tenantId in a fan-out job). Redaction runs after the merge so ALS-carried
  // secrets — should any ever accidentally end up there — still get scrubbed.
  const merged = { ...getRequestContext(), ...ctx };
  const redacted = redact(merged) as Record<string, unknown>;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...redacted,
  });
  const isSevere = level === "error" || level === "warn";
  // Prefer process.stdout/stderr on Node so container runtimes and k8s can
  // split streams cleanly. Looked up via globalThis: Edge has no
  // process.stdout, and Turbopack's edge-instrumentation compile rejects
  // the direct property access even behind a runtime guard.
  const proc = (
    globalThis as unknown as {
      process?: { stdout?: { write(s: string): void }; stderr?: { write(s: string): void } };
    }
  ).process;
  if (proc?.stdout && proc?.stderr) {
    (isSevere ? proc.stderr : proc.stdout).write(line + "\n");
    return;
  }
  (isSevere ? console.error : console.log)(line);
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  /** Return a new logger with `bind` merged into every subsequent emit. */
  child(bind: LogContext): Logger;
}

export function createLogger(base: LogContext = {}): Logger {
  const bind = (extra: LogContext): LogContext => ({ ...base, ...extra });
  return {
    debug: (m, c) => emit("debug", m, bind(c ?? {})),
    info: (m, c) => emit("info", m, bind(c ?? {})),
    warn: (m, c) => emit("warn", m, bind(c ?? {})),
    error: (m, c) => emit("error", m, bind(c ?? {})),
    child: (extra) => createLogger(bind(extra)),
  };
}

export const logger: Logger = createLogger();
