/**
 * Order lifecycle — the single authority every surface reads.
 *
 * placed → preparing → ready → (out_for_delivery, delivery only) → done
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
 * Language-free by design: steps carry a catalogue KEY, and whoever
 * renders them looks the words up in `src/lib/i18n/post-order.ts`.
 */

import type { PostOrderCopy } from "./i18n/post-order";

export const ORDER_STATUSES = ["placed", "preparing", "ready", "out_for_delivery", "done"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
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

/** Anything not terminal is open — the kitchen still owes it work. */
export function isOpenStatus(status: string): boolean {
  return status !== "done";
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

/** Index of the current status within the guest chain (-1 for unknown). */
export function stepIndex(status: string, orderType: string): number {
  return statusChain(orderType).indexOf(status as OrderStatus);
}
