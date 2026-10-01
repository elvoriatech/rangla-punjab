import {
  clampAcceptSeconds,
  clampEtaMinutes,
  DEFAULT_ETA_DELIVERY_MINUTES,
  DEFAULT_ETA_PICKUP_MINUTES,
} from "./ordering-config";

/**
 * The expected time of an order (owner, 2026-10-01).
 *
 * For an ASAP delivery or pickup order the restaurant promises a time.
 * It has a short ACCEPT WINDOW after the order reaches the board to set
 * that time and accept; once it accepts — or the window runs out — the
 * promise is fixed and is what the guest is shown:
 *
 *   accepted inside the window  → the minutes it chose
 *   window ran out unanswered   → the venue's default for that order type
 *
 * Nothing is written when the window runs out: "locked" is derived from
 * the clock, so there is no job to run and no state to drift. Planned
 * orders (the guest picked a time) and dine-in have no promise at all.
 */

/** Slack for the request that was sent just before the window closed. */
const WINDOW_GRACE_MS = 5_000;

export interface EtaOrder {
  orderType: string;
  status: string;
  requestedFor: Date | null;
  createdAt: Date;
  paidAt: Date | null;
  etaMinutes: number | null;
}

/** The venue's settings for this (Dashboard → Settings → Ordering). */
export interface EtaDefaults {
  etaDeliveryMinutes: number;
  etaPickupMinutes: number;
  /** How long the restaurant has to set the time on a new order. */
  etaAcceptSeconds: number;
}

/** The accept window in milliseconds, from the venue's setting. */
function windowMs(defaults?: Partial<EtaDefaults>): number {
  return clampAcceptSeconds(defaults?.etaAcceptSeconds) * 1000;
}

export interface OrderEta {
  /** The promise, in minutes from when the order reached the board. */
  minutes: number;
  /** That promise as a clock time. */
  expectedAt: Date;
  /** The restaurant chose it (true) or the default applied (false). */
  accepted: boolean;
  /** Until when the restaurant may still set it; null once it is fixed. */
  adjustableUntil: Date | null;
}

/** Does this order carry a promised time at all? */
export function etaApplies(order: Pick<EtaOrder, "orderType" | "requestedFor">): boolean {
  return (
    (order.orderType === "delivery" || order.orderType === "takeaway") &&
    order.requestedFor === null
  );
}

/** The venue's default promise for this order type. */
export function defaultEtaMinutes(orderType: string, defaults?: Partial<EtaDefaults>): number {
  return orderType === "delivery"
    ? clampEtaMinutes(defaults?.etaDeliveryMinutes, DEFAULT_ETA_DELIVERY_MINUTES)
    : clampEtaMinutes(defaults?.etaPickupMinutes, DEFAULT_ETA_PICKUP_MINUTES);
}

/** When the order reached the board — an online order when it was paid. */
export function boardedAt(order: Pick<EtaOrder, "createdAt" | "paidAt">): Date {
  return order.paidAt ?? order.createdAt;
}

/**
 * The order's promise, or null when it has none. `adjustableUntil` is set
 * only while the restaurant may still answer: the order is untouched
 * (`placed`, no minutes stored) and the window has not run out.
 */
export function orderEta(
  order: EtaOrder,
  defaults: Partial<EtaDefaults> | undefined,
  now: Date = new Date(),
): OrderEta | null {
  if (!etaApplies(order)) return null;
  const from = boardedAt(order);
  const accepted = order.etaMinutes !== null;
  const minutes = order.etaMinutes ?? defaultEtaMinutes(order.orderType, defaults);
  const deadline = new Date(from.getTime() + windowMs(defaults));
  const open = !accepted && order.status === "placed" && now.getTime() < deadline.getTime();
  return {
    minutes,
    expectedAt: new Date(from.getTime() + minutes * 60_000),
    accepted,
    adjustableUntil: open ? deadline : null,
  };
}

/** Server-side check for an accept request: a few seconds of grace for a
 *  tap that left the phone just before the window closed. */
export function withinAcceptWindow(
  order: Pick<EtaOrder, "createdAt" | "paidAt">,
  defaults: Partial<EtaDefaults> | undefined,
  now: Date = new Date(),
): boolean {
  return now.getTime() < boardedAt(order).getTime() + windowMs(defaults) + WINDOW_GRACE_MS;
}

/**
 * The promise as the GUEST may see it: only once it can no longer move
 * (accepted, or the window ran out), only on an order that is on the
 * board (an online order still awaiting payment has none yet), and only
 * while the order is still on its way.
 */
export function guestExpectedAt(
  order: EtaOrder & { paymentStatus: string },
  defaults: Partial<EtaDefaults> | undefined,
  now: Date = new Date(),
): Date | null {
  if (order.status === "done" || order.status === "cancelled") return null;
  if (order.paymentStatus === "pending" || order.paymentStatus === "failed") return null;
  const eta = orderEta(order, defaults, now);
  if (!eta || eta.adjustableUntil !== null) return null;
  return eta.expectedAt;
}
