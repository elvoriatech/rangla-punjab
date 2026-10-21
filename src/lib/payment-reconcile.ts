import { prisma } from "./db";
import { createLogger } from "./logger";

const log = createLogger();

/** Open attempts are looked at for this long: Stripe holds a card
 *  authorization for 7 days, so anything older can no longer be captured. */
export const RECONCILE_LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;

/** How often the in-process reconciler runs (and once at boot). */
export const RECONCILE_INTERVAL_MS = 2 * 60 * 1000;

export interface ReconcileTarget {
  tenantId: string;
  provider: "stripe" | "paypal";
  ref: string;
  orderId: string;
}

/**
 * The durable safety net for payments (owner, 2026-10-21): every payment
 * attempt still open or left "capturing" — webhook never arrived, server
 * was down, a crash between a capture and our write — is looked up at the
 * provider and processed exactly like a webhook would: an authorization
 * made in time is captured, a lapsed one released, money already taken is
 * recorded (and, if the order cannot take it, kept as `resolution =
 * needed` for a refund). Runs every RECONCILE_INTERVAL_MS from
 * instrumentation.ts and at every boot, so downtime is caught up on start.
 *
 * Listing crosses tenants, so it uses the reconciler's READ-ONLY policy
 * (`app.payment_reconciler`, see the 20261021130000 migration); every
 * write then happens inside the attempt's own tenant scope.
 */
export async function listReconcileTargets(
  maxRows = 50,
  now = Date.now(),
): Promise<ReconcileTarget[]> {
  const since = new Date(now - RECONCILE_LOOKBACK_MS);
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.payment_reconciler', 'on', true)`;
    return tx.paymentAttempt.findMany({
      where: {
        OR: [{ status: "open", createdAt: { gte: since } }, { status: "capturing" }],
      },
      orderBy: { createdAt: "asc" },
      take: maxRows,
      select: { tenantId: true, provider: true, ref: true, orderId: true },
    });
  });
  return rows.filter(
    (r): r is ReconcileTarget => r.provider === "stripe" || r.provider === "paypal",
  );
}

/** Process one batch. Each target on its own: one failure never stops the rest. */
export async function reconcilePayments(
  targets?: ReconcileTarget[],
): Promise<{ looked: number; settled: number; failed: number }> {
  const list = targets ?? (await listReconcileTargets());
  let settled = 0;
  let failed = 0;
  for (const t of list) {
    try {
      const outcome =
        t.provider === "stripe"
          ? await (
              await import("./connect-service")
            ).processStripeOrderPayment(t.tenantId, t.ref, {
              orderId: t.orderId,
              source: "reconcile",
            })
          : await (
              await import("./paypal-service")
            ).processPayPalOrderPayment(t.tenantId, t.ref, {
              orderId: t.orderId,
              source: "reconcile",
            });
      if (outcome.kind === "settled") settled += 1;
    } catch (err) {
      failed += 1;
      log.warn("payment.reconcile_failed", {
        provider: t.provider,
        ref: t.ref,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (list.length > 0) log.info("payment.reconciled", { looked: list.length, settled, failed });
  return { looked: list.length, settled, failed };
}
