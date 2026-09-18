"use client";

/**
 * Guest cart, stored per venue in localStorage. Strictly-necessary
 * functional storage (ePrivacy-exempt): it exists only while the guest
 * builds an order, carries no identifiers, and is cleared on completion.
 *
 * State flows through a custom window event so the floating drawer and
 * every Add button stay in sync without a React context spanning the
 * server-rendered page.
 */

export interface CartLine {
  itemId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

const EVENT = "rangla-cart-updated";
const MAX_LINES = 50;
const MAX_QTY = 50;

function storageKey(slug: string): string {
  return `rangla-order:${slug}`;
}

export function readCart(slug: string): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is CartLine =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as CartLine).itemId === "string" &&
        typeof (l as CartLine).name === "string" &&
        Number.isInteger((l as CartLine).priceCents) &&
        Number.isInteger((l as CartLine).quantity) &&
        (l as CartLine).quantity > 0,
    );
  } catch {
    return [];
  }
}

function writeCart(slug: string, lines: CartLine[]): void {
  try {
    if (lines.length === 0) {
      window.localStorage.removeItem(storageKey(slug));
    } else {
      window.localStorage.setItem(storageKey(slug), JSON.stringify(lines.slice(0, MAX_LINES)));
    }
  } catch {
    // Storage full / blocked — the cart degrades to in-memory-only silently.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function addToCart(
  slug: string,
  item: { itemId: string; name: string; priceCents: number },
): void {
  const lines = readCart(slug);
  const existing = lines.find((l) => l.itemId === item.itemId);
  if (existing) {
    existing.quantity = Math.min(MAX_QTY, existing.quantity + 1);
  } else {
    lines.push({ ...item, quantity: 1 });
  }
  writeCart(slug, lines);
}

export function setQuantity(slug: string, itemId: string, quantity: number): void {
  let lines = readCart(slug);
  if (quantity <= 0) {
    lines = lines.filter((l) => l.itemId !== itemId);
  } else {
    const line = lines.find((l) => l.itemId === itemId);
    if (line) line.quantity = Math.min(MAX_QTY, quantity);
  }
  writeCart(slug, lines);
}

export function clearCart(slug: string): void {
  writeCart(slug, []);
}

export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Re-render hook: fires on every cart write in this tab (custom event)
 *  and on writes from other tabs (storage event). */
export function subscribeToCart(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export const EMPTY_CART: CartLine[] = [];

// useSyncExternalStore needs referentially-stable snapshots — re-parse
// only when the underlying string actually changed.
let snapshotCache: { slug: string; raw: string | null; lines: CartLine[] } | null = null;

export function getCartSnapshot(slug: string): CartLine[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey(slug));
  } catch {
    raw = null;
  }
  if (snapshotCache && snapshotCache.slug === slug && snapshotCache.raw === raw) {
    return snapshotCache.lines;
  }
  const lines = raw === null ? EMPTY_CART : readCart(slug);
  snapshotCache = { slug, raw, lines };
  return lines;
}

/** Client-safe price formatter (public-menu's formatPrice pulls in the
 *  server-only db module, so cart components use this twin). Mirrors
 *  `formatPrice`'s fallback: `Intl` throws on a malformed locale or an
 *  unknown currency code, and a cart that renders no prices at all is a
 *  worse failure than an unstyled amount. */
export function formatCents(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || "en", {
      style: "currency",
      currency: currency || "EUR",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || "EUR"}`;
  }
}

/**
 * Idempotency key for one order submit.
 *
 * `crypto.randomUUID` needs a secure context: it is there on HTTPS and
 * on localhost, but not when the dev server is reached over plain HTTP
 * on a LAN address (phone-testing a QR code). The fallback keeps enough
 * entropy for a per-submit key — it only has to be unique among this
 * venue's orders, not unguessable.
 */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
