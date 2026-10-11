/**
 * "B-12" / "O-7" for an order in a number series (owner, 2026-10-11: cash and
 * online orders count separately), the plain number for an order placed
 * before the split. Pure, so client components can use it too.
 */
export function orderLabel(order: { orderNumber: number; orderSeries?: string | null }): string {
  return order.orderSeries
    ? `${order.orderSeries}-${order.orderNumber}`
    : String(order.orderNumber);
}
