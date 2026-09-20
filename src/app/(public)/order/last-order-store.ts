"use client";

/**
 * The last few orders this browser placed at this venue, so the menu can
 * offer a way back to them.
 *
 * The website has no accounts and no order history — a web guest's only
 * record of an order is the tracking link in their confirmation and their
 * receipt email. That is fine until they want to complain, at which point
 * "open the link we emailed you" is the whole answer, and the complaint
 * never gets raised. This remembers just enough to put the tracking page
 * one tap away: the order's id, its receipt token (which IS the
 * authorization — see `receipt-token.ts`) and when it was placed.
 *
 * Same posture as `cart-store.ts`: one localStorage key per venue slug,
 * strictly-necessary functional storage (ePrivacy-exempt), every access
 * wrapped so a browser that refuses storage degrades to "no stored
 * order" rather than throwing. Nothing here is ever sent to the server;
 * the token it holds was minted BY the server for this device.
 *
 * The token is a bearer credential, so the list is deliberately short
 * (`MAX_ORDERS`) — a browser on a shared tablet should not accumulate a
 * month of other people's orders.
 */

export interface LastOrder {
  orderId: string;
  receiptToken: string;
  /** ISO timestamp, for ordering and for expiry we may want later. */
  placedAt: string;
}

const MAX_ORDERS = 5;

/** Fired on write so a mounted button re-reads immediately: the `storage`
 *  event never fires in the tab that did the writing. */
export const LAST_ORDER_EVENT = "rangla-last-order-updated";

function storageKey(slug: string): string {
  return `rangla-last-orders:${slug}`;
}

function isLastOrder(value: unknown): value is LastOrder {
  if (typeof value !== "object" || value === null) return false;
  const o = value as LastOrder;
  return (
    typeof o.orderId === "string" &&
    o.orderId.length > 0 &&
    typeof o.receiptToken === "string" &&
    o.receiptToken.length > 0 &&
    typeof o.placedAt === "string"
  );
}

/** Newest first. Empty on the server, on a blocked/parse-failed store, and
 *  on a first visit — all of which the caller treats the same way. */
export function readLastOrders(slug: string): LastOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLastOrder).slice(0, MAX_ORDERS);
  } catch {
    return [];
  }
}

/** The one the Complaint button should open, or null. */
export function readLastOrder(slug: string): LastOrder | null {
  return readLastOrders(slug)[0] ?? null;
}

/**
 * Remember an order this browser just placed. Newest first, de-duplicated
 * by `orderId` so a re-render or a retried submit cannot push the same
 * order in twice, and capped at `MAX_ORDERS`.
 */
export function rememberOrder(slug: string, order: LastOrder): void {
  if (typeof window === "undefined") return;
  if (!isLastOrder(order)) return;
  const next = [order, ...readLastOrders(slug).filter((o) => o.orderId !== order.orderId)].slice(
    0,
    MAX_ORDERS,
  );
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(next));
  } catch {
    // Storage full or blocked. The confirmation on screen still carries
    // the tracking link, so the guest is not stranded — they simply do
    // not get the shortcut on their next visit.
  }
  window.dispatchEvent(new Event(LAST_ORDER_EVENT));
}

/** Subscription for `useSyncExternalStore`: our own write event plus the
 *  cross-tab `storage` one. */
export function subscribeLastOrders(callback: () => void): () => void {
  window.addEventListener(LAST_ORDER_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(LAST_ORDER_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Test seam / privacy escape hatch: forget everything for this venue. */
export function clearLastOrders(slug: string): void {
  try {
    window.localStorage.removeItem(storageKey(slug));
  } catch {
    // Nothing to do — an unreadable store is already "forgotten".
  }
  window.dispatchEvent(new Event(LAST_ORDER_EVENT));
}
