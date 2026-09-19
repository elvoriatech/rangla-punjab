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
  /** Emoji the website shows for this category (Appearance → icons);
   *  null/absent = names only, or an older server. */
  icon?: string | null;
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
/**
 * The venue's loyalty programme as the MENU advertises it — config only,
 * no personal data, so it rides the public menu payload. Absent on an
 * older server or when the venue never switched the programme on; every
 * loyalty surface in the app stays hidden in that case.
 */
export interface ApiLoyaltyConfig {
  enabled: boolean;
  /** Food subtotal an order must reach to earn anything. */
  minOrderCents: number;
  /** Points a qualifying order is worth. */
  pointsPerOrder: number;
  /** Points that buy one reward. */
  rewardPoints: number;
  /** What that reward is worth. */
  rewardValueCents: number;
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
  /** Absent on an older server ⇒ no rewards UI anywhere. */
  loyalty?: ApiLoyaltyConfig;
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
  /**
   * Spend the guest's ARMED voucher on this order. Only ever true when
   * `/api/v1/me/loyalty` said there is one — the server re-checks, applies
   * `min(voucher.valueCents, total)` and redeems it, so the app's preview
   * is a courtesy, never the authority.
   */
  redeemVoucher?: boolean;
  address?: { street: string; zip: string; city?: string; note?: string };
}
export interface PlacedOrder {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  receiptToken: string;
  /** What the voucher took off, 0 when none was applied (or the server
   *  predates redemption). */
  discountCents: number;
  /** What still has to be paid. Falls back to `totalCents` on an older
   *  server, which is the pre-redemption behaviour. */
  chargedCents: number;
  /** The reward covered the whole order: it is already paid, and the app
   *  must skip every payment step. */
  paidByVoucher: boolean;
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
  // The three redemption fields are read defensively: a server that
  // predates vouchers sends none of them, and the order then behaves
  // exactly as it did before — nothing discounted, everything payable.
  const totalCents = Number(body.totalCents ?? 0);
  const discountCents = Number(body.discountCents ?? 0);
  const chargedCents = typeof body.chargedCents === "number" ? body.chargedCents : totalCents;
  return {
    ok: true,
    order: {
      orderId: body.orderId,
      orderNumber: Number(body.orderNumber ?? 0),
      totalCents,
      receiptToken: String(body.receiptToken ?? ""),
      discountCents,
      chargedCents,
      // Derived as well as read: "nothing left to charge on a discounted
      // order" is the same fact, and an older-but-redeeming server may
      // only send the amounts.
      paidByVoucher: body.paidByVoucher === true || (discountCents > 0 && chargedCents === 0),
    },
  };
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
  /** How the order was (or is to be) paid. "voucher" means a reward
   *  covered it outright. Absent on older servers. */
  paymentProvider?: string | null;
  /** Optional: older servers don't send the lines. */
  items?: ApiTrackItem[];
  /** What a redeemed reward took off this order; absent/0 = none. */
  discountCents?: number;
  /** The CHARGED total — i.e. already net of `discountCents`. */
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
/**
 * Ask the server to check with Stripe whether this order's card payment
 * succeeded and settle it if so — the belt to the webhook's braces. Called
 * right after the sheet reports success and while tracking waits for
 * "paid". True when the order is (now) paid.
 */
export async function verifyPayment(orderId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/pay/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => null)) as { paid?: boolean } | null;
    return res.ok && body?.paid === true;
  } catch {
    return false;
  }
}

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

/**
 * A reservation as the server describes it back to the guest.
 *
 * `status` stays widened to `string`: the restaurant's workflow may grow
 * a state after this build shipped, and an unknown one must render as
 * itself rather than disappear.
 */
export interface ReservationView {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  guests: number;
  name: string;
  status: "requested" | "confirmed" | "declined" | (string & {});
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** Who to ring while the request is still open. `phone` is null when
   *  the venue publishes none. */
  venue: { name: string; phone: string | null };
}

/** Defensive read: anything without an id is not a reservation. */
function asReservation(raw: unknown): ReservationView | null {
  const r = raw as Partial<ReservationView> | null;
  if (!r || typeof r.id !== "string") return null;
  const venue = (r.venue ?? {}) as Partial<ReservationView["venue"]>;
  return {
    id: r.id,
    date: typeof r.date === "string" ? r.date : "",
    time: typeof r.time === "string" ? r.time : "",
    guests: Number(r.guests ?? 0),
    name: typeof r.name === "string" ? r.name : "",
    status: typeof r.status === "string" ? r.status : "requested",
    note: typeof r.note === "string" && r.note.trim() ? r.note : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    venue: {
      name: typeof venue.name === "string" ? venue.name : "",
      phone: typeof venue.phone === "string" && venue.phone.trim() ? venue.phone : null,
    },
  };
}

/**
 * Request a table. The restaurant confirms by phone — this only files
 * the request, so there is nothing to pay and no account needed.
 *
 * The three tracking fields are read defensively: a server that predates
 * reservation status sends none of them, and the app then behaves exactly
 * as it did before — a confirmation screen and nothing to follow up.
 */
export async function createReservation(
  input: ReservationInput,
): Promise<
  | { ok: true; id: string | null; token: string | null; status: string | null }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      return { ok: false, error: String(body?.error ?? `http_${res.status}`) };
    }
    return {
      ok: true,
      id: typeof body?.id === "string" ? body.id : null,
      token: typeof body?.token === "string" ? body.token : null,
      status: typeof body?.status === "string" ? body.status : null,
    };
  } catch {
    return { ok: false, error: "network" };
  }
}

/**
 * One reservation, read with the token this device stored when it was
 * filed. Null for every "nothing to show" case — 403/404 (withdrawn or a
 * token that no longer matches), offline, a server without the route —
 * so the caller has one thing to check. Never throws.
 */
export async function fetchReservation(id: string, token: string): Promise<ReservationView | null> {
  if (!id || !token) return null;
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/reservations/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      reservation?: unknown;
    } | null;
    if (!body?.ok) return null;
    return asReservation(body.reservation);
  } catch {
    return null;
  }
}

/**
 * Every reservation attached to the signed-in account, across devices.
 * Empty for signed out, 401, offline or a server without the route —
 * the device's own list then stands alone. Never throws.
 */
export async function fetchMyReservations(token: string | null): Promise<ReservationView[]> {
  if (!token) return [];
  try {
    const res = await fetch(`${BASE_URL}/api/v1/me/reservations`, {
      headers: { "X-Customer-Token": token },
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      reservations?: unknown;
    } | null;
    if (!body?.ok || !Array.isArray(body.reservations)) return [];
    return body.reservations.map(asReservation).filter((r): r is ReservationView => r !== null);
  } catch {
    return [];
  }
}

/* ── Loyalty ─────────────────────────────────────────────────────────────
 *
 * Points the guest collects on qualifying orders, and the vouchers those
 * points turn into. Everything here is account-scoped, so it needs the
 * customer token — and every field is read defensively: a build can meet
 * a server that predates the programme, or one that has grown a voucher
 * state this build never heard of.
 *
 * "Armed" means only "the guest switched this voucher on for their next
 * order". Actually discounting an order is a separate, server-side step.
 */

/** The voucher lifecycle this build knows. A newer server may grow it,
 *  so the field below stays widened to `string` — the UI offers a
 *  voucher only when it recognises the state as available or armed. */
export type ApiVoucherStatus = "available" | "armed" | "redeemed" | "expired" | "revoked";

export interface ApiVoucher {
  id: string;
  valueCents: number;
  status: ApiVoucherStatus | (string & {});
  /** ISO timestamp; always shown to the guest, never silently dropped. */
  expiresAt: string;
  /** The order this voucher was spent on, once it has been. Null while it
   *  is still available/armed, and on a server that predates redemption. */
  redeemedOrderNumber: number | null;
}

/** Why the balance moved. `orderNumber` is set for order-shaped rows;
 *  "redeem" is the points-neutral (delta 0) note that a voucher was
 *  spent on that order. */
export type ApiLoyaltyReason = "order" | "reversal" | "voucher" | "adjust" | "redeem";

export interface ApiLoyaltyEntry {
  id: string;
  delta: number;
  reason: ApiLoyaltyReason | (string & {});
  orderNumber: number | null;
  /** The voucher's own value on the rows that are ABOUT a voucher
   *  ("voucher" = minted, "redeem" = spent); null on every other reason,
   *  and on a server that predates the field — callers then fall back to
   *  the programme's configured reward value. */
  valueCents: number | null;
  createdAt: string;
}

export interface ApiLoyalty extends ApiLoyaltyConfig {
  balance: number;
  vouchers: ApiVoucher[];
  history: ApiLoyaltyEntry[];
}

function asVoucher(raw: unknown): ApiVoucher | null {
  const v = raw as Partial<ApiVoucher> | null;
  if (!v || typeof v.id !== "string") return null;
  return {
    id: v.id,
    valueCents: Number(v.valueCents ?? 0),
    status: typeof v.status === "string" ? v.status : "available",
    expiresAt: typeof v.expiresAt === "string" ? v.expiresAt : "",
    redeemedOrderNumber: typeof v.redeemedOrderNumber === "number" ? v.redeemedOrderNumber : null,
  };
}

/**
 * This customer's points, vouchers and recent movements.
 *
 * Null for every "no rewards to show" case — signed out, 401, offline,
 * a server without the route — so callers have one thing to check and
 * the UI simply doesn't appear. Never throws.
 */
export async function fetchLoyalty(token: string | null): Promise<ApiLoyalty | null> {
  if (!token) return null;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/me/loyalty`, {
      headers: { "X-Customer-Token": token },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      loyalty?: Partial<ApiLoyalty>;
    } | null;
    const l = body?.loyalty;
    if (!body?.ok || !l) return null;
    return {
      enabled: l.enabled !== false,
      balance: Number(l.balance ?? 0),
      rewardPoints: Number(l.rewardPoints ?? 0),
      rewardValueCents: Number(l.rewardValueCents ?? 0),
      minOrderCents: Number(l.minOrderCents ?? 0),
      pointsPerOrder: Number(l.pointsPerOrder ?? 0),
      vouchers: (Array.isArray(l.vouchers) ? l.vouchers : [])
        .map(asVoucher)
        .filter((v): v is ApiVoucher => v !== null),
      history: (Array.isArray(l.history) ? l.history : [])
        .map((raw) => {
          const e = raw as Partial<ApiLoyaltyEntry> | null;
          if (!e || typeof e.id !== "string") return null;
          return {
            id: e.id,
            delta: Number(e.delta ?? 0),
            reason: typeof e.reason === "string" ? e.reason : "adjust",
            orderNumber: typeof e.orderNumber === "number" ? e.orderNumber : null,
            valueCents: typeof e.valueCents === "number" ? e.valueCents : null,
            createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
          } satisfies ApiLoyaltyEntry;
        })
        .filter((e): e is ApiLoyaltyEntry => e !== null),
    };
  } catch {
    return null;
  }
}

/**
 * Switch a voucher on (or off) for the guest's next order. The server
 * owns the rule that only one can be armed at a time, so the caller
 * re-reads `fetchLoyalty` afterwards rather than patching state locally.
 */
export async function setVoucherArmed(
  token: string | null,
  voucherId: string,
  armed: boolean,
): Promise<{ ok: true; voucher: ApiVoucher } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "unauthorized" };
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/me/loyalty/vouchers/${encodeURIComponent(voucherId)}/arm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Customer-Token": token },
        body: JSON.stringify({ armed }),
      },
    );
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      voucher?: unknown;
      error?: string;
    } | null;
    const voucher = asVoucher(body?.voucher);
    if (!res.ok || !voucher)
      return { ok: false, error: String(body?.error ?? `http_${res.status}`) };
    return { ok: true, voucher };
  } catch {
    return { ok: false, error: "network" };
  }
}
