import { asTenant } from "./tenant";
import { recordOrderEventTx } from "./order-events";
import { orderEta } from "./order-eta";
import { parseOrderingConfig } from "./ordering-config";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * Pickup orders close themselves (owner, 2026-10-23): a delivery is set to
 * "done" by the driver's scan, but a pickup stayed open until someone tapped
 * it. Now a pickup (takeaway) order on the board is set to "done" this long
 * after its pickup time — the guest has collected it, or is not coming.
 */
export const PICKUP_AUTO_DONE_AFTER_MS = 20 * 60 * 1000;

/** Only orders this recent are looked at (a bounded query). */
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/** Still open on the board: accepted or not (an auto-accepted order stays
 *  "placed"), preparing, or ready. */
const OPEN = ["placed", "preparing", "ready"];

export interface PickupOrderTiming {
  orderType: string;
  status: string;
  requestedFor: Date | null;
  createdAt: Date;
  paidAt: Date | null;
  etaMinutes: number | null;
}

/**
 * When the guest picks it up: the time they chose for a planned order,
 * otherwise the promised time (accepted minutes, or the venue's default
 * after the accept window) — the same promise the guest and the board see.
 */
export function pickupTime(
  order: PickupOrderTiming,
  defaults: Parameters<typeof orderEta>[1],
): Date | null {
  if (order.orderType !== "takeaway") return null;
  if (order.requestedFor) return order.requestedFor;
  return orderEta(order, defaults)?.expectedAt ?? null;
}

/** Due for closing now? Pure, so it is unit-tested. */
export function isPickupDue(
  order: PickupOrderTiming & { paymentStatus: string },
  defaults: Parameters<typeof orderEta>[1],
  now: Date,
): boolean {
  if (order.orderType !== "takeaway" || !OPEN.includes(order.status)) return false;
  // An online order still waiting for its money is not on the board.
  if (order.paymentStatus === "pending" || order.paymentStatus === "failed") return false;
  const at = pickupTime(order, defaults);
  return at !== null && now.getTime() - at.getTime() >= PICKUP_AUTO_DONE_AFTER_MS;
}

/**
 * Close every due pickup order of the tenant. Each update is guarded on the
 * status it was read in, so an order a person changed in the meantime is
 * left alone. Returns how many were closed.
 */
export async function autoCompletePickups(tenantId: string, now = new Date()): Promise<number> {
  const closedIds = await asTenant(tenantId, async (tx) => {
    const orders = await tx.order.findMany({
      where: {
        orderType: "takeaway",
        status: { in: OPEN },
        createdAt: { gte: new Date(now.getTime() - LOOKBACK_MS) },
      },
      select: {
        id: true,
        tenantId: true,
        venueId: true,
        orderNumber: true,
        orderSeries: true,
        orderType: true,
        status: true,
        paymentStatus: true,
        requestedFor: true,
        createdAt: true,
        paidAt: true,
        etaMinutes: true,
        venue: { select: { ordering: true } },
      },
    });
    const closed: { id: string; paymentStatus: string }[] = [];
    for (const o of orders) {
      const config = parseOrderingConfig(o.venue.ordering);
      if (!isPickupDue(o, config, now)) continue;
      const updated = await tx.order.updateMany({
        where: { id: o.id, status: o.status },
        data: { status: "done" },
      });
      if (updated.count === 0) continue;
      closed.push({ id: o.id, paymentStatus: o.paymentStatus });
      await recordOrderEventTx(tx, {
        tenantId: o.tenantId,
        venueId: o.venueId,
        orderId: o.id,
        orderLabel: o.orderSeries ? `${o.orderSeries}-${o.orderNumber}` : String(o.orderNumber),
        kind: "order.status",
        actor: "system",
        summary: `${o.status} → done (automatically, 20 min after the pickup time)`,
        payload: { from: o.status, to: "done", auto: "pickup" },
      });
    }
    return closed;
  });
  if (closedIds.length > 0) {
    log.info("orders.pickup_auto_done", { tenantId, closed: closedIds.length });
    // Same as a person ticking it done (advanceOrderStatus): a CASH order
    // earns its loyalty points now — an online one already did at payment.
    // Idempotent at the ledger, fire-and-forget.
    const { creditOrderIfEligible } = await import("./loyalty-service");
    for (const o of closedIds) {
      if (o.paymentStatus !== "paid") {
        await creditOrderIfEligible(tenantId, o.id).catch(() => undefined);
      }
    }
  }
  return closedIds.length;
}

/** The timer's job: the one restaurant (single-restaurant build). */
export async function runPickupAutoDone(): Promise<number> {
  const { resolveRestaurantTenantId } = await import("./payment-reconcile");
  const tenantId = await resolveRestaurantTenantId();
  if (!tenantId) return 0;
  return autoCompletePickups(tenantId);
}
