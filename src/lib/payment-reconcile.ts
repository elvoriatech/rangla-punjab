import { prisma } from "./db";
import { asTenant } from "./tenant";
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
 * payment-reconciler-timer.ts and at every boot, so downtime is caught up.
 *
 * Single-restaurant build (architect review, 2026-10-21): the reconciler
 * works for THE restaurant only — resolved the way the public menu does
 * (RESTAURANT_SLUG → resolve_public_venue) — and entirely inside its
 * tenant scope. No cross-tenant reads.
 */

/** The one restaurant's tenant, or null (logged) when it cannot be found. */
export async function resolveRestaurantTenantId(): Promise<string | null> {
  try {
    const { getRestaurantSlug } = await import("./restaurant");
    const slug = await getRestaurantSlug();
    const rows = await prisma.$queryRaw<{ venue_id: string; tenant_id: string }[]>`
      SELECT * FROM resolve_public_venue(${slug})
    `;
    const tenantId = rows[0]?.tenant_id ?? null;
    if (!tenantId) log.warn("payment.reconcile_no_restaurant", { slug });
    return tenantId;
  } catch (err) {
    log.warn("payment.reconcile_no_restaurant", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** The restaurant's attempts still open (last 8 days) or "capturing". */
export async function listReconcileTargets(
  tenantId: string,
  maxRows = 50,
  now = Date.now(),
): Promise<ReconcileTarget[]> {
  const since = new Date(now - RECONCILE_LOOKBACK_MS);
  const rows = await asTenant(tenantId, (tx) =>
    tx.paymentAttempt.findMany({
      where: {
        OR: [{ status: "open", createdAt: { gte: since } }, { status: "capturing" }],
      },
      orderBy: { createdAt: "asc" },
      take: maxRows,
      select: { provider: true, ref: true, orderId: true },
    }),
  );
  return rows
    .filter((r) => r.provider === "stripe" || r.provider === "paypal")
    .map((r) => ({
      tenantId,
      provider: r.provider as "stripe" | "paypal",
      ref: r.ref,
      orderId: r.orderId,
    }));
}

/**
 * Process one batch for the restaurant (or the given targets). Each target
 * on its own: one failure never stops the rest. When the restaurant cannot
 * be resolved, the run is skipped and logged — it never throws.
 */
export async function reconcilePayments(
  targets?: ReconcileTarget[],
): Promise<{ looked: number; settled: number; failed: number }> {
  let list = targets;
  if (!list) {
    const tenantId = await resolveRestaurantTenantId();
    if (!tenantId) return { looked: 0, settled: 0, failed: 0 };
    list = await listReconcileTargets(tenantId);
  }
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
