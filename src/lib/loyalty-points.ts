/**
 * Points an order's FOOD value earns: `pointsPerOrder` for every FULL
 * `minOrderCents` step — at the defaults, 5 points per €20, so €19.99
 * earns 0, €20–39.99 earn 5, €60 earns 15. A zero threshold can't be
 * divided by, so there every order earns the flat `pointsPerOrder`.
 *
 * The one rule the server credits by and every cart previews with —
 * web (`cart-drawer.tsx`) and app (`mobile/src/loyalty.tsx` mirrors it)
 * — so what a guest is promised is what lands in the ledger.
 */
export function pointsForFood(
  config: { minOrderCents: number; pointsPerOrder: number },
  foodCents: number,
): number {
  if (config.pointsPerOrder <= 0 || foodCents <= 0) return 0;
  if (config.minOrderCents <= 0) return config.pointsPerOrder;
  return Math.floor(foodCents / config.minOrderCents) * config.pointsPerOrder;
}
