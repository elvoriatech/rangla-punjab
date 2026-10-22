import { orderCode } from "./order-code";

/**
 * The order reference as the app shows it: the public code "RP-K7M3Q"
 * (owner, 2026-10-22). Prefers the server's ready-made `orderLabel`; builds it from
 * `orderSeries` otherwise; falls back to the number for an older server.
 */
export function orderLabelOf(o: {
  orderNumber: number | string;
  orderLabel?: string | null;
  orderSeries?: string | null;
}): string {
  if (o.orderLabel) return o.orderLabel;
  // The public code "RP-K7M3Q" (2026-10-22), computed the same way as the
  // server's — for a payload from a server that does not send it yet.
  return orderCode(o.orderSeries ?? null, Number(o.orderNumber));
}
