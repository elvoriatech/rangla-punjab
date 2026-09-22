import { asTenant } from "./tenant";
import { parseOrderingConfig } from "./ordering-config";
import { createLogger } from "./logger";

const log = createLogger();

/**
 * The guest's own "Cancel order" on a CASH order (owner, 2026-09-22).
 *
 * A cash order goes to the kitchen the moment it is placed, so the exit is
 * time-boxed: the venue's `cashCancelMinutes` (default 10, 0 = off) from
 * placing, and only while the order is still `placed` or `preparing` —
 * never once it is ready, on its way or done. Online-paid orders keep their
 * own exits (`cancelUnpaidOrderByGuest` / `switchUnpaidOrderToCash`).
 *
 * The deadline is computed HERE, on the server clock, and every client
 * (app, web tracker) only draws the button until it passes; the write
 * re-checks it, so a stale screen can never cancel late.
 */

/** Statuses a guest may still call off. */
const CANCELLABLE = ["placed", "preparing"] as const;

export interface CashCancelOrder {
  status: string;
  paymentStatus: string;
  paymentProvider: string | null;
  createdAt: Date;
}

/** A pay-at-the-restaurant order: nothing charged online, nothing pending. */
export function isCashOrder(
  order: Pick<CashCancelOrder, "paymentStatus" | "paymentProvider">,
): boolean {
  return order.paymentStatus === "none" && order.paymentProvider === null;
}

/**
 * When the guest's cancel window closes, or null when there is none
 * (switched off, not a cash order, already too far along, or already past).
 */
export function cashCancelDeadline(
  order: CashCancelOrder,
  minutes: number,
  now: Date = new Date(),
): Date | null {
  if (minutes <= 0 || !isCashOrder(order)) return null;
  if (!(CANCELLABLE as readonly string[]).includes(order.status)) return null;
  const until = new Date(order.createdAt.getTime() + minutes * 60_000);
  return until > now ? until : null;
}

export type CashCancelResult =
  { ok: true } | { ok: false; error: "not_found" | "not_cash" | "window_closed" };

export async function cancelCashOrderByGuest(
  tenantId: string,
  orderId: string,
  now: Date = new Date(),
): Promise<CashCancelResult> {
  const outcome = await asTenant(tenantId, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: {
        status: true,
        paymentStatus: true,
        paymentProvider: true,
        createdAt: true,
        venue: { select: { ordering: true } },
      },
    });
    if (!order) return { ok: false as const, error: "not_found" as const };
    if (!isCashOrder(order)) return { ok: false as const, error: "not_cash" as const };
    const minutes = parseOrderingConfig(order.venue.ordering).cashCancelMinutes;
    if (!cashCancelDeadline(order, minutes, now)) {
      return { ok: false as const, error: "window_closed" as const };
    }
    // The same guards again, inside the write: a kitchen that just marked
    // it ready, or a second tap, changes nothing.
    const earliest = new Date(now.getTime() - minutes * 60_000);
    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { in: [...CANCELLABLE] },
        paymentStatus: "none",
        paymentProvider: null,
        createdAt: { gt: earliest },
      },
      data: { status: "cancelled" },
    });
    return updated.count === 1
      ? { ok: true as const }
      : { ok: false as const, error: "window_closed" as const };
  });
  if (!outcome.ok) return outcome;

  log.info("order.cash_cancelled_by_guest", { orderId, tenantId });
  // Undo whatever placing it moved (a redeemed reward), as a kitchen
  // cancel does, and tell the restaurant — the kitchen already had it.
  const { reverseOrderCredit } = await import("./loyalty-service");
  void reverseOrderCredit(tenantId, orderId).catch(() => undefined);
  const { sendGuestCancelPush } = await import("./push-service");
  void sendGuestCancelPush(tenantId, orderId);
  return { ok: true };
}
