import { prisma } from "./db";
import { createLogger } from "./logger";
import { getAccess } from "./team-access";
import { asUser } from "./tenant";

const log = createLogger();

/**
 * Deleting an order (owner, 2026-10-01).
 *
 * Orders are the books, so almost none of them can go. The one kind that
 * can: an order that was CANCELLED and on which NO MONEY MOVED — a test
 * order, a mis-tap, a no-show. It generated no revenue and no refund, so
 * removing it changes no total anywhere. Everything else stays.
 *
 * The order row and its lines are really deleted (one source of truth:
 * it disappears from the dashboard, the kitchen, the app and the
 * reports at once). What remains is a `deleted_orders` line — number,
 * date, amount, who, and the reason the owner had to type.
 */

export const DELETE_REASON_MIN = 3;
export const DELETE_REASON_MAX = 300;

export type DeleteOrderError =
  "forbidden" | "not_found" | "not_cancelled" | "money_moved" | "reason_required";

/**
 * May this order be deleted at all? Pure, so the page can decide whether
 * to draw the button with the same rule the service enforces.
 *
 * "Money moved" is any payment that was taken (`paid`), given back
 * (`refunded`), or a gift card spent on it: each of those has a
 * counterpart in a statement that this row explains.
 */
export function orderDeleteBlock(order: {
  status: string;
  paymentStatus: string;
  giftCardDiscountCents: number;
}): "not_cancelled" | "money_moved" | null {
  if (order.status !== "cancelled") return "not_cancelled";
  if (order.paymentStatus === "paid" || order.paymentStatus === "refunded") return "money_moved";
  if (order.giftCardDiscountCents > 0) return "money_moved";
  return null;
}

export async function deleteCancelledOrder(
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
        orderType: true,
        status: true,
        paymentStatus: true,
        giftCardDiscountCents: true,
        totalCents: true,
        currency: true,
        createdAt: true,
      },
    });
    if (!order) return { ok: false as const, error: "not_found" as const };
    const block = orderDeleteBlock(order);
    if (block) return { ok: false as const, error: block };

    await tx.deletedOrder.create({
      data: {
        tenantId: order.tenantId,
        venueId: order.venueId,
        orderNumber: order.orderNumber,
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
