import { logger } from "./logger";

/**
 * The payment safety net (owner, 2026-10-21): every few minutes, and once at
 * boot so downtime is caught up immediately, open and "capturing" payment
 * attempts are looked up at Stripe / PayPal and finished — captured if the
 * guest authorized in time, released otherwise, recorded if money moved.
 * Same in-process timer pattern as partition maintenance (instrumentation
 * .ts): one app container, no queue or host cron to forget. A run never
 * overlaps the previous one, and a failure only warns. Node.js only.
 */
export function startPaymentReconciler(): void {
  if (process.env.PAYMENT_RECONCILER === "0") {
    logger.info("payments.reconciler_disabled");
    return;
  }
  // `next build` imports instrumentation to collect metadata; no DB work then.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const { reconcilePayments } = await import("./payment-reconcile");
      await reconcilePayments();
    } catch (err) {
      logger.warn("payments.reconcile_run_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      running = false;
    }
  };

  void run();
  void import("./payment-reconcile").then(({ RECONCILE_INTERVAL_MS }) => {
    // unref so a pending tick never holds the process open on shutdown.
    setInterval(() => void run(), RECONCILE_INTERVAL_MS).unref();
  });
}

/**
 * Pickup orders close themselves 20 minutes after their pickup time (owner,
 * 2026-10-23; see pickup-autodone.ts). Same in-process timer pattern: every
 * two minutes and once at boot, never overlapping, failures only warn.
 */
export function startPickupAutoDone(): void {
  if (process.env.PICKUP_AUTO_DONE === "0") {
    logger.info("orders.pickup_auto_done_disabled");
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const { runPickupAutoDone } = await import("./pickup-autodone");
      await runPickupAutoDone();
    } catch (err) {
      logger.warn("orders.pickup_auto_done_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => void run(), 2 * 60 * 1000).unref();
}
