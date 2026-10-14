import { prisma } from "./db";
import { recordOrderEventTx } from "./order-events";
import { createLogger } from "./logger";
import { getAccess } from "./team-access";
import { asUser } from "./tenant";

const log = createLogger();

/**
 * Deleting an order — owner only.
 *
 * Until 2026-10-11 only a cancelled order on which no money moved could go.
 * The owner then asked to delete ANY order (owner, 2026-10-11: "we are
 * connected to our Kasse, add deletion of orders for the owner"): the
 * restaurant's certified till is its book of record, this system feeds it.
 *
 * What does not go away is the trail. The order row and its lines are
 * deleted (gone from the dashboard, kitchen, app and reports at once), but
 * a `deleted_orders` line is written first — number and series, type,
 * payment status, amount, when it was placed, who deleted it and the
 * reason the owner had to type — and that log has no delete of its own.
 * Order numbers are never reused (`nextOrderNumber` counts the log too).
 */

export const DELETE_REASON_MIN = 3;
export const DELETE_REASON_MAX = 300;

export type DeleteOrderError = "forbidden" | "not_found" | "reason_required";

export async function deleteOrder(
  userId: string,
  orderId: string,
  reasonRaw: string,
): Promise<{ ok: true; orderNumber: number } | { ok: false; error: DeleteOrderError }> {
  const access = await getAccess(userId);
  if (!access?.isOwner) return { ok: false, error: "forbidden" };
  const reason = reasonRaw.trim().slice(0, DELETE_REASON_MAX);
  if (reason.length < DELETE_REASON_MIN) return { ok: false, error: "reason_required" };

  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  return asUser(userId, async (tx) => {
    // RLS scopes this to the owner's own restaurant: another tenant's
    // order id is simply not found.
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        venueId: true,
        orderNumber: true,
        orderSeries: true,
        orderType: true,
        status: true,
        paymentStatus: true,
        totalCents: true,
        currency: true,
        createdAt: true,
      },
    });
    if (!order) return { ok: false as const, error: "not_found" as const };

    // The order log keeps a full copy of what is about to disappear.
    const snapshot = await tx.order.findFirst({ where: { id: orderId }, include: { items: true } });
    await recordOrderEventTx(tx, {
      tenantId: order.tenantId,
      venueId: order.venueId,
      orderId: order.id,
      orderLabel: order.orderSeries
        ? `${order.orderSeries}-${order.orderNumber}`
        : String(order.orderNumber),
      kind: "order.deleted",
      actor: `restaurant:${actor?.email ?? userId}`,
      summary: `Deleted · reason: ${reason}`,
      payload: { reason, order: snapshot },
    });

    await tx.deletedOrder.create({
      data: {
        tenantId: order.tenantId,
        venueId: order.venueId,
        orderNumber: order.orderNumber,
        orderSeries: order.orderSeries ?? null,
        orderType: order.orderType,
        paymentStatus: order.paymentStatus,
        totalCents: order.totalCents,
        currency: order.currency,
        placedAt: order.createdAt,
        reason,
        deletedBy: actor?.email ?? userId,
      },
    });
    // Lines and any complaint thread cascade; loyalty ledger lines keep
    // their history with the order reference cleared (SET NULL).
    await tx.order.delete({ where: { id: order.id } });
    log.info("order.deleted", { orderId: order.id, orderNumber: order.orderNumber, userId });
    return { ok: true as const, orderNumber: order.orderNumber };
  });
}

export interface DeletedOrderRow {
  id: string;
  orderNumber: number;
  /** "B" (cash) / "O" (online); null on older orders. */
  orderSeries?: string | null;
  orderType: string;
  totalCents: number;
  currency: string;
  placedAt: Date;
  reason: string;
  deletedBy: string;
  deletedAt: Date;
}

/** The deletion log for a period (by when the order was DELETED), newest
 *  first. Read by the Reports page; the caller has already been gated. */
export async function listDeletedOrders(
  userId: string,
  venueId: string,
  range: { from: Date; to: Date },
): Promise<DeletedOrderRow[]> {
  const rows = await asUser(userId, (tx) =>
    tx.deletedOrder.findMany({
      where: { venueId, createdAt: { gte: range.from, lte: range.to } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    orderType: r.orderType,
    totalCents: r.totalCents,
    currency: r.currency,
    placedAt: r.placedAt,
    reason: r.reason,
    deletedBy: r.deletedBy,
    deletedAt: r.createdAt,
  }));
}
