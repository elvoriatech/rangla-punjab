/**
 * Order lifecycle — the single authority every surface reads.
 *
 * placed → preparing → ready → (out_for_delivery, delivery only) → done
 *                    ↘ cancelled (out of band, from any open status)
 *
 * One pure module decides what a valid transition is, what the staff
 * button says next, and which steps the guest tracker renders — the
 * kitchen board, the dashboard list, the guest status page and the
 * mobile app can never disagree about where an order stands.
 *
 * Forward-only: staff may skip ahead (a rush order can go placed → done
 * in one tap) but never backwards — "un-cooking" an order would lie to
 * a guest who already saw "ready".
 *
 * `cancelled` is the one status OFF the chain. It is reachable from every
 * open status and leads nowhere, so it can never be modelled as a step:
 * `statusChain` never contains it, `nextStatus` never returns it, and
 * `stepIndex` answers -1 — the tracker draws a cancelled banner instead
 * of a rail rather than pretending the order walked to a fifth step.
 *
 * Language-free by design: steps carry a catalogue KEY, and whoever
 * renders them looks the words up in `src/lib/i18n/post-order.ts`.
 */

import type { PostOrderCopy } from "./i18n/post-order";

export const ORDER_STATUSES = [
  "placed",
  "preparing",
  "ready",
  "out_for_delivery",
  "done",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The two ends of an order's life. Nothing leaves either of them, and
 * every "is the kitchen still working on this?" question — the board's
 * open/closed split, the dashboard's two lists, the staff summary count
 * — reads this set rather than comparing against `"done"` by hand.
 */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ["done", "cancelled"];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/** The order was called off. Terminal, and off the guest's step rail. */
export function isCancelledStatus(status: string): boolean {
  return status === "cancelled";
}

/** The chain an order of this type walks. Delivery inserts the courier leg. */
export function statusChain(orderType: string): readonly OrderStatus[] {
  return orderType === "delivery"
    ? (["placed", "preparing", "ready", "out_for_delivery", "done"] as const)
    : (["placed", "preparing", "ready", "done"] as const);
}

/** Forward-only, skip-ahead allowed, terminal is terminal. */
export function canTransition(from: string, to: string, orderType: string): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false;
  const chain = statusChain(orderType);
  const a = chain.indexOf(from as OrderStatus);
  // Cancelling is out of band: it is not a step further along the chain,
  // so it is offered from anywhere the order is still open — including
  // the courier leg, where the driver turns back — and from nowhere else.
  // A cancelled or finished order stays that way; reopening one would
  // hand back food, points and money that have all already moved.
  if (to === "cancelled") return a !== -1 && !TERMINAL_STATUSES.includes(from);
  // Leaving `cancelled` needs no special case: it is not on the chain, so
  // `a` is -1 and the guard below already refuses every destination.
  const b = chain.indexOf(to as OrderStatus);
  if (a === -1 || b === -1) return false; // e.g. out_for_delivery on a dine-in order
  return b > a;
}

/** The next step in the chain, or null when the order is done. */
export function nextStatus(current: string, orderType: string): OrderStatus | null {
  const chain = statusChain(orderType);
  const i = chain.indexOf(current as OrderStatus);
  if (i === -1 || i === chain.length - 1) return null;
  return chain[i + 1]!;
}

/** Anything not terminal is open — the kitchen still owes it work. A
 *  cancelled order owes nothing, so it is closed exactly like a done one. */
export function isOpenStatus(status: string): boolean {
  return !(TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Staff-facing label for the button that advances an order TO `to`. */
export function advanceLabel(to: OrderStatus): string {
  switch (to) {
    case "preparing":
      return "Start preparing";
    case "ready":
      return "Ready";
    case "out_for_delivery":
      return "Out for delivery";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancel";
    default:
      return to;
  }
}

/** Which entry of `postOrderCopy(locale).steps` words a tracker step. One
 *  status can have several wordings — "ready" is "Ready for pickup" on a
 *  takeaway order and plain "Ready" on a dine-in one. */
export type GuestStepLabel = keyof PostOrderCopy["steps"];

export interface GuestStep {
  key: OrderStatus;
  /** Catalogue key, not a word: this module stays language-free so the
   *  tracker page, the v1 API and the app can each render it in their
   *  own locale from `src/lib/i18n/post-order.ts`. */
  label: GuestStepLabel;
}

/** The tracker steps a guest sees, worded per order type (mockup wording). */
export function guestSteps(orderType: string): GuestStep[] {
  const done: GuestStep =
    orderType === "delivery"
      ? { key: "done", label: "delivered" }
      : orderType === "takeaway"
        ? { key: "done", label: "pickedUp" }
        : { key: "done", label: "served" };
  const ready: GuestStep =
    orderType === "takeaway"
      ? { key: "ready", label: "readyForPickup" }
      : { key: "ready", label: "ready" };
  const steps: GuestStep[] = [
    { key: "placed", label: "confirmed" },
    { key: "preparing", label: "preparing" },
    ready,
  ];
  if (orderType === "delivery") steps.push({ key: "out_for_delivery", label: "onTheWay" });
  steps.push(done);
  return steps;
}

/** Index of the current status within the guest chain (-1 for unknown,
 *  and for `cancelled`, which is off the chain by design — a caller that
 *  gets -1 renders a cancelled state instead of the rail). */
export function stepIndex(status: string, orderType: string): number {
  return statusChain(orderType).indexOf(status as OrderStatus);
}
