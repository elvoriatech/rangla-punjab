/**
 * The order number as the app shows it: "B-12" (cash) / "O-7" (online), or
 * the plain number for an order from before the two series (owner,
 * 2026-10-11). Prefers the server's ready-made `orderLabel`; builds it from
 * `orderSeries` otherwise; falls back to the number for an older server.
 */
export function orderLabelOf(o: {
  orderNumber: number | string;
  orderLabel?: string | null;
  orderSeries?: string | null;
}): string {
  if (o.orderLabel) return o.orderLabel;
  return o.orderSeries ? `${o.orderSeries}-${o.orderNumber}` : String(o.orderNumber);
}
