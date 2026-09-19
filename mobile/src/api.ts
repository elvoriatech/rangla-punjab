import AsyncStorage from "@react-native-async-storage/async-storage";
/**
 * The app's whole server contract — the /api/v1 reads plus the existing
 * order placement route. Money is integer cents, image URLs absolute,
 * and unknown enum values must be tolerated (the server may grow the
 * lifecycle after this build shipped).
 */
import { Platform } from "react-native";

// Dev default: the local web app. Android emulators can't see `localhost`,
// they reach the host via 10.0.2.2. Override per build with
// EXPO_PUBLIC_API_URL (baked at build time, expo convention).
const fallback = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? fallback;

export interface ApiVariant {
  id: string;
  name: string;
  priceDeltaCents: number;
}
export interface ApiItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** Present while an offer is active: regular price for the strikethrough. */
  offer?: { basePriceCents: number; endsAt: string | null } | null;
  currency: string;
  isAvailable: boolean;
  allergens: string[];
  traces: string[];
  dietary: string[];
  spice: number;
  photoUrl: string;
  variants: ApiVariant[];
}
export interface ApiCategory {
  id: string;
  name: string;
  photoUrl: string | null;
  items: ApiItem[];
}
export interface ApiDeliveryArea {
  zip: string;
  locality?: string;
  feeCents?: number;
  minCents?: number;
  freeOverCents?: number;
}
export interface ApiOrdering {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  deliveryAreas: ApiDeliveryArea[];
  deliveryFeeCents: number;
  deliveryMinCents: number;
  acceptedPayments: string[];
  onlinePayment: boolean;
  paypal?: boolean;
  /** Later-today "HH:MM" pickup/delivery slots inside opening hours,
   *  server-built. Absent/empty = ASAP only (older servers don't send it). */
  requestSlots?: string[];
  /** Table reservations offered? Absent on older servers ⇒ hide the UI. */
  reservations?: boolean;
  /** Bookable date → times, enumerated by the server from opening hours,
   *  so the app can only offer what /api/reservations accepts. */
  reservationSlots?: { date: string; times: string[] }[];
}
export interface ApiMenu {
  ok: true;
  venue: {
    name: string;
    slug: string;
    currency: string;
    locale: string;
    /** The venue's own language, and every language it publishes.
     *  Optional: an older server sends neither, and the app then offers
     *  its whole catalogue. */
    defaultLocale?: string | null;
    enabledLocales?: string[] | null;
    logoUrl: string | null;
    hours: unknown;
  };
  ordering: ApiOrdering;
  categories: ApiCategory[];
}

/** The server emits absolute image URLs against its own origin; in dev
 *  that's `localhost`, which an Android emulator can't reach — rebase
 *  any localhost image onto BASE_URL (10.0.2.2 on Android). */
function rebaseUrl<T extends string | null>(url: T): T {
  if (!url) return url;
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, BASE_URL) as T;
}

export async function fetchMenu(locale?: string): Promise<ApiMenu> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const res = await fetch(`${BASE_URL}/api/v1/menu${qs}`);
  if (!res.ok) throw new Error(`menu ${res.status}`);
  const menu = (await res.json()) as ApiMenu;
  return {
    ...menu,
    venue: { ...menu.venue, logoUrl: rebaseUrl(menu.venue.logoUrl) },
    categories: menu.categories.map((c) => ({
      ...c,
      photoUrl: rebaseUrl(c.photoUrl),
      items: c.items.map((i) => ({ ...i, photoUrl: rebaseUrl(i.photoUrl) })),
    })),
  };
}

export type OrderType = "dine_in" | "takeaway" | "delivery";

export interface PlaceOrderInput {
  slug: string;
  items: { itemId: string; quantity: number }[];
  orderType: OrderType;
  /** Venue-local "HH:MM" for today (pickup/delivery). Absent = ASAP. */
  requestedTime?: string;
  tableNumber?: string;
  customerName?: string;
  customerPhone?: string;
  /** Optional, any order type: the receipt (with VAT split) is emailed here. */
  customerEmail?: string;
  /** Tells the server when to mail the receipt: now (cash) or once an
   *  online payment settles. The guest picks the method in the cart
   *  BEFORE placing, so this is their actual choice — the order is still
   *  created first and paid immediately afterwards (sheet or web page),
   *  because a card that fails must not lose the basket. */
  intendedPayment?: "cash" | "card" | "paypal";
  address?: { street: string; zip: string; city?: string; note?: string };
}
export interface PlacedOrder {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  receiptToken: string;
}

/** Where the in-flight submit's idempotency key is parked. */
const ATTEMPT_KEY = "rangla-order-attempt";

/**
 * Unique enough for one venue's order stream. Hermes has no
 * `crypto.randomUUID`, so this is time + randomness rather than a UUID.
 */
function newRequestId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The idempotency key for this basket, reused across retries.
 *
 * Persisted rather than held in memory because mobile is exactly where
 * the bad case happens: the request goes out, the connection drops, the
 * app is backgrounded or killed, and the customer reopens it and taps
 * Pay again. A key that only lived in memory would be gone by then and
 * the kitchen would get a second order.
 *
 * Bound to a signature of the payload, so editing the basket mints a
 * fresh key instead of being handed back the previous order.
 */
async function requestIdFor(signature: string): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(ATTEMPT_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { key?: unknown; signature?: unknown };
      if (typeof saved.key === "string" && saved.signature === signature) return saved.key;
    }
  } catch {
    // Unreadable store — fall through and mint a fresh key. Worst case
    // we lose de-duplication for this attempt, which is the old behaviour.
  }
  const key = newRequestId();
  try {
    await AsyncStorage.setItem(ATTEMPT_KEY, JSON.stringify({ key, signature }));
  } catch {
    /* best effort */
  }
  return key;
}

export async function placeOrder(
  input: PlaceOrderInput,
  customerToken?: string | null,
): Promise<{ ok: true; order: PlacedOrder } | { ok: false; error: string }> {
  const signature = JSON.stringify(input);
  const clientRequestId = await requestIdFor(signature);

  const res = await fetch(`${BASE_URL}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Signed-in customers get the order linked to their account.
      ...(customerToken ? { "X-Customer-Token": customerToken } : {}),
    },
    body: JSON.stringify({ ...input, clientRequestId }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || typeof body.orderId !== "string") {
    // Keep the key: the next tap must be recognised as the same submit.
    return { ok: false, error: String(body?.error ?? `http_${res.status}`) };
  }
  // Landed (201) or replayed (200) — either way this basket is done, so
  // retire the key before the customer starts a new order.
  await AsyncStorage.removeItem(ATTEMPT_KEY).catch(() => {});
  return { ok: true, order: body as unknown as PlacedOrder };
}

export interface ApiTrackStep {
  key: string;
  labelDe: string;
  labelEn: string;
  reached: boolean;
}
export interface ApiTrackItem {
  name: string;
  quantity: number;
  priceCents: number;
  lineTotalCents: number;
}
export interface ApiTracking {
  id: string;
  orderNumber: number;
  status: string;
  currentStepIndex: number;
  steps: ApiTrackStep[];
  orderType: string;
  paymentStatus: string;
  /** Optional: older servers don't send the lines. */
  items?: ApiTrackItem[];
  totalCents: number;
  currency: string;
  tableNumber: string | null;
  placedAt: string;
}

export async function fetchOrderStatus(orderId: string, token: string): Promise<ApiTracking> {
  const res = await fetch(
    `${BASE_URL}/api/v1/orders/${encodeURIComponent(orderId)}/status?token=${encodeURIComponent(token)}`,
  );
  const body = (await res.json().catch(() => null)) as { ok?: boolean; order?: ApiTracking } | null;
  if (!res.ok || !body?.ok || !body.order) throw new Error(`status ${res.status}`);
  return body.order;
}

/**
 * One payable attempt at an order, minted by the server.
 *
 * `mode` is the provider seam: "real" is a Stripe PaymentIntent whose
 * `clientSecret` + `publishableKey` drive the native sheet; "fake" is the
 * dev/CI provider, which has no sheet at all — the app settles it through
 * `confirmFakePayment` behind an obviously-labelled test button.
 */
export interface PaymentIntentInfo {
  mode: "real" | "fake";
  /** Provider reference; `confirmFakePayment` needs it in fake mode. */
  ref: string;
  clientSecret: string;
  /** Null when the venue's Stripe account has no publishable key yet — the
   *  server answers 409 in that case, so this is belt and braces. */
  publishableKey: string | null;
  amountCents: number;
  currency: string;
  merchantName: string;
}

export async function createPaymentIntent(
  orderId: string,
  token: string,
): Promise<{ ok: true; intent: PaymentIntentInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/pay/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => null)) as
      (Partial<PaymentIntentInfo> & { error?: string }) | null;
    if (!res.ok || !body || typeof body.clientSecret !== "string") {
      return { ok: false, error: String(body?.error ?? `http_${res.status}`) };
    }
    return {
      ok: true,
      intent: {
        mode: body.mode === "fake" ? "fake" : "real",
        ref: String(body.ref ?? ""),
        clientSecret: body.clientSecret,
        publishableKey: typeof body.publishableKey === "string" ? body.publishableKey : null,
        amountCents: Number(body.amountCents ?? 0),
        currency: String(body.currency ?? "eur"),
        merchantName: String(body.merchantName ?? ""),
      },
    };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Settles a FAKE intent (dev/CI only — the real provider settles through
 *  Stripe and its webhook). */
export async function confirmFakePayment(
  orderId: string,
  token: string,
  ref: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/pay/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ref }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The hosted checkout page (Stripe Checkout, or the local fake pay page).
 *  The fallback whenever the native sheet can't run: Expo Go, web, a venue
 *  without a publishable key. */
export async function startHostedPayment(
  orderId: string,
  token: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || typeof body?.url !== "string") {
      return { ok: false, error: String(body?.error ?? `http_${res.status}`) };
    }
    return { ok: true, url: body.url };
  } catch {
    return { ok: false, error: "network" };
  }
}

export function payPageUrl(orderId: string, token: string, appReturnUrl?: string): string {
  const app = appReturnUrl ? `&app=${encodeURIComponent(appReturnUrl)}` : "";
  return `${BASE_URL}/pay/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}${app}`;
}

/** The receipt PDF is rendered server-side; `locale` picks the copy (the
 *  guest's app language, not the venue's). */
export function receiptUrl(orderId: string, token: string, locale: string): string {
  return `${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/receipt?token=${encodeURIComponent(token)}&locale=${encodeURIComponent(locale)}`;
}

export interface ReservationInput {
  slug: string;
  name: string;
  phone: string;
  guests: number;
  date: string;
  time: string;
  note?: string;
}

/** Request a table. The restaurant confirms by phone — this only files
 *  the request, so there is nothing to pay and no account needed. */
export async function createReservation(
  input: ReservationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `http_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network" };
  }
}
