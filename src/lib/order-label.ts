import { orderCode } from "./order-code";

/**
 * The order reference people SEE: the public code "RP-K7M3Q" (owner,
 * 2026-10-22) — on the dashboard, board, kitchen tickets, receipts, guest
 * status, mails, pushes, complaints and dispatch. Derived from the internal
 * number and series, which stay unchanged (see order-code.ts). Pure, so
 * client components can use it too.
 */
export function orderLabel(order: { orderNumber: number; orderSeries: string | null }): string {
  // `orderSeries` is REQUIRED (not optional): a caller that forgets to
  // select it would silently get another order's-looking code.
  return orderCode(order.orderSeries ?? null, order.orderNumber);
}

/**
 * The INTERNAL number — "B-12" / "O-7" (cash and online count separately,
 * owner 2026-10-11), the plain number for an order from before the split.
 * Not shown to guests or staff; only for accounting exports and
 * reconciliation, and what order history stores.
 */
export function internalOrderNumber(order: {
  orderNumber: number;
  orderSeries?: string | null;
}): string {
  return order.orderSeries
    ? `${order.orderSeries}-${order.orderNumber}`
    : String(order.orderNumber);
}
