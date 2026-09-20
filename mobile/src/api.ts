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
  /**
   * May an order be placed for RIGHT NOW? False while the venue is shut:
   * the server refuses an ASAP or dine-in order with
   * `409 venue_closed`, but still takes a scheduled pickup or delivery
   * into a later open slot today.
   *
   * Absent on a server that predates the flag, which `fetchMenu`
   * normalises to `true` — an older server has no closed state to
   * report, and hiding "Now" on its say-so would stop every order.
   */
  acceptsAsapNow?: boolean;
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
    /**
     * The venue's IANA zone (e.g. "Europe/Berlin"), when the server
     * sends it — the clock `hours` above is written in.
     *
     * Optional: today's /api/v1/menu does not include it, and the app
     * then falls back to the zone baked into the build
     * (EXPO_PUBLIC_VENUE_TIMEZONE, see src/hours.ts). Never the DEVICE's
     * zone — a guest abroad must not be the one deciding the kitchen is
     * shut. With no zone at all the app simply shows the server's
     * `openNow` below, exactly as it did before.
     */
    timezone?: string | null;
    /**
     * Whether the kitchen is open RIGHT NOW, as the server judged it
     * against the venue's own timezone.
     *
     * Optional, and deliberately never computed here: `hours` is on this
     * payload but the venue's zone is not, and a phone roaming two
     * timezones away must not be the thing that tells a guest the place
     * is shut. A server that doesn't send it leaves the header's pill
     * off entirely.
     */
    openNow?: boolean | null;
    /**
     * How a guest can reach the restaurant by phone (landline, mobile,
     * WhatsApp). Null — and absent on any server that predates the
     * feature, or whose owner has filled none of the three in — means no
     * contact card anywhere in the app.
     */
    contact?: ApiVenueContact | null;
  };
  ordering: ApiOrdering;
  categories: ApiCategory[];
  /**
   * How many items currently carry an ACTIVE offer (P7-12) — the server
   * decides "active" against its own clock and timezone, so this is not
   * something the app may recompute at will.
   *
   * Optional: a server that predates P7-12 sends nothing, and `fetchMenu`
   * then falls back to counting the items in THIS payload that came with
   * an `offer` — the same definition, just resolved one step later. Every
   * offers surface hides itself while the count is 0.
   */
  offerCount?: number;
  /** Absent on an older server ⇒ no rewards UI anywhere. */
  loyalty?: ApiLoyaltyConfig;
  /**
   * The venue's Google rating and the link that opens Google's own
   * "write a review" form (P7-14).
   *
   * Null — and absent on any server that predates the feature, or whose
   * venue has no Place ID, or whose Places API key is ⛔ not configured —
   * means simply: no rating line anywhere in the app. The app NEVER
   * computes or caches this itself; the number on screen is whatever the
   * server last read from Google.
   */
  rating?: ApiRating | null;
}

export interface ApiRating {
  /** Google's average, 1–5. */
  value: number;
  /** How many ratings it averages. */
  count: number;
  /** Absolute https URL to Google's review form. */
  reviewUrl: string;
}

/** The server emits absolute image URLs against its own origin; in dev
 *  that's `localhost`, which an Android emulator can't reach — rebase
 *  any localhost image onto BASE_URL (10.0.2.2 on Android). */
export function rebaseUrl<T extends string | null>(url: T): T {
  if (!url) return url;
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, BASE_URL) as T;
}

/**
 * The published menu.
 *
 * `fresh` is the app's explicit re-read (foreground, the five-minute
 * tick, an owner saving hours or flipping a service): it must reach the
 * ORIGIN rather than a CDN copy, because the clock-dependent halves of
 * this payload — `openNow`, `acceptsAsapNow`, `requestSlots` — are
 * exactly what is being re-read. The server accepts two ways of asking
 * (src/app/api/v1/menu/route.ts): `Cache-Control: no-cache`, which is
 * CORS-allowed so the Expo-web surface's preflight passes, and `?fresh=1`
 * for any client whose request headers get rewritten in transit. Both go
 * out, plus `cache: "reload"` for the platform's own HTTP cache; the
 * server answers a fresh read `private, no-store`, so nothing keeps it.
 */
export async function fetchMenu(locale?: string, options?: { fresh?: boolean }): Promise<ApiMenu> {
  const params = new URLSearchParams();
  if (locale) params.set("locale", locale);
  if (options?.fresh) params.set("fresh", "1");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(
    `${BASE_URL}/api/v1/menu${qs}`,
    options?.fresh ? { cache: "reload", headers: { "Cache-Control": "no-cache" } } : undefined,
  );
  if (!res.ok) throw new Error(`menu ${res.status}`);
  const menu = (await res.json()) as ApiMenu;
  const categories = menu.categories.map((c) => ({
    ...c,
    photoUrl: rebaseUrl(c.photoUrl),
    items: c.items.map((i) => ({ ...i, photoUrl: rebaseUrl(i.photoUrl) })),
  }));
  return {
    ...menu,
    ordering: {
      ...menu.ordering,
      // Anything that is not an explicit `false` means "accepting" —
      // the same posture as `openNow`, inverted, because this one
      // decides whether a basket can be sent at all.
      acceptsAsapNow: menu.ordering?.acceptsAsapNow !== false,
    },
    venue: {
      ...menu.venue,
      logoUrl: rebaseUrl(menu.venue.logoUrl),
      timezone: typeof menu.venue.timezone === "string" ? menu.venue.timezone.trim() : null,
      // Anything that is not an actual boolean is "nobody said", not
      // "closed" — the pill hides rather than inventing a verdict.
      openNow: typeof menu.venue.openNow === "boolean" ? menu.venue.openNow : null,
      contact: asVenueContact(menu.venue.contact),
    },
    categories,
    offerCount: offerCountOf(menu.offerCount, categories),
    rating: asRating(menu.rating),
  };
}

/**
 * The Google rating, read the way everything else here is: anything that
 * isn't a complete, plausible rating is no rating at all (P7-14).
 *
 * Strict on purpose. A half-read rating would put a wrong number under
 * the venue's name, and "★ NaN" beside a review link is worse than no
 * line — so a missing count, a rating outside 1–5, or a review URL that
 * isn't plain https all collapse to null.
 */
function asRating(raw: unknown): ApiRating | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const value = typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null;
  const count =
    typeof r.count === "number" && Number.isFinite(r.count) ? Math.trunc(r.count) : null;
  const reviewUrl = typeof r.reviewUrl === "string" ? r.reviewUrl.trim() : "";
  if (value === null || count === null || count < 0) return null;
  if (value < 1 || value > 5) return null;
  // Only ever a web link: this string goes straight to `Linking.openURL`,
  // and the server is not the place to be handed an app scheme from.
  if (!/^https?:\/\//i.test(reviewUrl)) return null;
  return { value, count, reviewUrl };
}

/**
 * One way to phone the restaurant.
 *
 * The server owns all three strings: `number` is E.164, `display` is the
 * same number grouped for reading, and `href` is what a tap opens —
 * `tel:+49…` for a phone, `https://wa.me/49…` for WhatsApp. The app
 * formats none of it and dials nothing it built itself.
 */
export interface ApiContactEntry {
  number: string;
  display: string;
  href: string;
}

/** The venue's phone book. Any of the three may be absent — an owner who
 *  fills in only a mobile gets exactly one row on the Account screen. */
export interface ApiVenueContact {
  landline: ApiContactEntry | null;
  mobile: ApiContactEntry | null;
  whatsapp: ApiContactEntry | null;
}

/** The digits of a phone number, which is what `wa.me` wants. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * One contact entry, read as defensively as everything else here.
 *
 * A row with no number is no row. `display` falls back to the number
 * itself, and a missing or unusable `href` is REBUILT rather than
 * dropped: `tel:` from the E.164 number, `https://wa.me/<digits>` for
 * WhatsApp — both of which are exactly what the server would have sent.
 * What is never honoured is an arbitrary scheme: this string goes
 * straight to `Linking.openURL`, so only `tel:` and http(s) survive.
 */
function asContactEntry(raw: unknown, kind: "phone" | "whatsapp"): ApiContactEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const number = typeof c.number === "string" ? c.number.trim() : "";
  if (!digitsOf(number)) return null;
  const display = typeof c.display === "string" && c.display.trim() ? c.display.trim() : number;
  const href = typeof c.href === "string" ? c.href.trim() : "";
  const usable = kind === "whatsapp" ? /^https?:\/\//i.test(href) : /^tel:/i.test(href);
  return {
    number,
    display,
    href: usable
      ? href
      : kind === "whatsapp"
        ? `https://wa.me/${digitsOf(number)}`
        : `tel:${number}`,
  };
}

/** The whole phone book, or null when not one of the three is usable —
 *  which is the single test every contact surface makes. */
export function asVenueContact(raw: unknown): ApiVenueContact | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const contact: ApiVenueContact = {
    landline: asContactEntry(c.landline, "phone"),
    mobile: asContactEntry(c.mobile, "phone"),
    whatsapp: asContactEntry(c.whatsapp, "whatsapp"),
  };
  return contact.landline || contact.mobile || contact.whatsapp ? contact : null;
}

/** Every entry the venue actually published, in the order a guest reads
 *  them. Empty means: no contact card. */
export function contactEntries(
  contact: ApiVenueContact | null | undefined,
): { key: keyof ApiVenueContact; entry: ApiContactEntry }[] {
  if (!contact) return [];
  const order: (keyof ApiVenueContact)[] = ["landline", "mobile", "whatsapp"];
  return order
    .map((key) => ({ key, entry: contact[key] }))
    .filter(
      (row): row is { key: keyof ApiVenueContact; entry: ApiContactEntry } => row.entry !== null,
    );
}

/** The server's own count when it sends one, else the offers visible in
 *  this payload. Never NaN and never negative, so `> 0` is the whole
 *  test every offers surface makes. */
function offerCountOf(raw: unknown, categories: ApiCategory[]): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  return categories.reduce((n, c) => n + c.items.filter((i) => i.offer).length, 0);
}

/**
 * The id the OFFERS destination answers to. Deliberately the same
 * sentinel the website gives its synthetic first section
 * (`data-category-id="__offers"`), so "the offers tab" means one thing
 * across both clients. It is never a real category id — the server's are
 * cuids.
 */
export const OFFERS_CATEGORY_ID = "__offers";

/** Every item in the menu that is on offer right now, in menu order —
 *  the "Offers" destination's contents (P7-12). Items keep their real
 *  category, so adding one to the basket is unchanged. */
export function offerItems(menu: ApiMenu): ApiItem[] {
  return menu.categories.flatMap((c) => c.items.filter((i) => i.offer));
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
  /**
   * Spend a gift card on this order. Any code the guest can produce is
   * valid — a card is a BEARER instrument, so this is deliberately not
   * limited to cards the account bought.
   *
   * A reward and a card can both apply: the server spends the reward
   * first and the card covers what is left. Single use, full value —
   * whatever the card is worth beyond this bill is gone, which is why
   * the cart makes the guest confirm that in so many words.
   */
  giftCardCode?: string;
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
  /** What a gift card took off, 0 when none was applied (or the server
   *  predates gift cards). The app previews a discount; THIS is the
   *  authority, and a 0 here against a preview means the card was
   *  refused. */
  giftCardDiscountCents: number;
  /** The last four characters of the code that was spent — what the
   *  receipt and the "Gift card ····1234" line show. */
  giftCardLast4: string | null;
  /** A gift card settled the whole order: it is already paid, and every
   *  payment step must be skipped, exactly like `paidByVoucher`. */
  paidByGiftCard: boolean;
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
  // Read exactly as defensively as the voucher fields beside them: a
  // server that predates gift cards sends none of these, and an order
  // then behaves as it always did.
  const giftCardDiscountCents = Number(body.giftCardDiscountCents ?? 0);
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
      giftCardDiscountCents,
      giftCardLast4: typeof body.giftCardLast4 === "string" ? body.giftCardLast4 : null,
      // Derived as well as read, for the same reason the voucher flag is:
      // "nothing left to charge on a card-discounted order" is the same
      // fact, and a server may only send the amounts.
      paidByGiftCard:
        body.paidByGiftCard === true || (giftCardDiscountCents > 0 && chargedCents === 0),
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
  /** The points that reward cost. Absent on a server that predates the
   *  column, and 0 on an order placed before it — the reward line then
   *  shows the money without the points rather than "0 points". */
  discountPoints?: number;
  /** What a gift card took off this order; absent/0 = none. A reward and
   *  a card can both appear — the server spends the reward first. */
  giftCardDiscountCents?: number;
  /** The last four characters of the code that paid, for the
   *  "Gift card ····1234" line. Absent/null = no card. */
  giftCardLast4?: string | null;
  /** When the order left the kitchen, ISO — what the "on the way" step
   *  is timestamped with. Absent/null until it does, and on every order
   *  that is not a delivery. */
  outForDeliveryAt?: string | null;
  /** The CHARGED total — i.e. already net of `discountCents`. */
  totalCents: number;
  currency: string;
  tableNumber: string | null;
  placedAt: string;
  /** The complaint thread on this order, when one exists. Absent on a
   *  server that predates P7-10 ⇒ no problem has been reported. */
  issue?: { status: string; updatedAt: string } | null;
  /** May the guest still OPEN a thread? False once the venue's reporting
   *  window has passed (an existing thread stays usable regardless).
   *  Absent on an older server ⇒ treated as "no". */
  canReport?: boolean;
  /**
   * Where to leave the venue a Google review. The SERVER decides whether
   * to offer one at all — it is sent only when the venue has a Place ID
   * and has not switched its rating off — so the app never assembles a
   * Maps link of its own. Null/absent ⇒ no ask.
   *
   * `url` is OUR OWN tracked redirect, not Google's link: it records the
   * tap and then 302s the guest on. `prompted` is that record coming
   * back — true once this guest has followed it, which is how the ask
   * stops being asked. Absent (an older server, which has no tracking
   * route either) reads as false, so those builds behave exactly as
   * they did: the CTA simply stays.
   */
  review?: ApiOrderReview | null;
}

/** The post-order review ask: where to send the guest, and whether they
 *  have already been. */
export interface ApiOrderReview {
  url: string;
  prompted: boolean;
}

/**
 * The raw body of `GET /api/v1/orders/{id}/status`.
 *
 * `issue`, `canReport` and `review` sit at the TOP LEVEL, NOT inside
 * `order` — `order` carries the tracking fields alone. Reading them off
 * `order` (as this once did) silently hid the "Report a problem" button,
 * the complaint pill and the rate-us ask on every build. They are still
 * looked up inside `order` as a fallback, so a server that nests them
 * keeps working.
 */
interface ApiOrderStatusBody {
  ok?: boolean;
  order?: ApiTracking;
  issue?: unknown;
  canReport?: unknown;
  review?: unknown;
}

export async function fetchOrderStatus(orderId: string, token: string): Promise<ApiTracking> {
  const res = await fetch(
    `${BASE_URL}/api/v1/orders/${encodeURIComponent(orderId)}/status?token=${encodeURIComponent(token)}`,
  );
  const body = (await res.json().catch(() => null)) as ApiOrderStatusBody | null;
  if (!res.ok || !body?.ok || !body.order) throw new Error(`status ${res.status}`);
  const order = body.order;
  // Top level first, `order` only when the key is absent there. All three
  // are read defensively: an older server sends none of them, and the app
  // then shows no complaint surface at all.
  const rawIssue = body.issue !== undefined ? body.issue : order.issue;
  const rawCanReport = body.canReport !== undefined ? body.canReport : order.canReport;
  const rawReview = body.review !== undefined ? body.review : order.review;
  return {
    ...order,
    issue: asIssueSummary(rawIssue),
    canReport: rawCanReport === true,
    review: asReview(rawReview),
  };
}

/**
 * The write-a-review link, read as strictly as the rating's own.
 *
 * http(s) only: this string goes straight to the system browser, and an
 * app scheme arriving from the network is not something to hand the OS
 * on a guest's behalf.
 *
 * `prompted` is read as "true ONLY if the server said so". Anything else
 * — absent, null, the string "true", an older server that never heard of
 * the field — is false, i.e. "keep asking". Getting this wrong in the
 * other direction would silently swallow the ask for every guest on a
 * server that hasn't shipped the tracking route yet.
 */
function asReview(raw: unknown): ApiOrderReview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const trimmed = typeof r.url === "string" ? r.url.trim() : "";
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return { url: trimmed, prompted: r.prompted === true };
}

/* ── Complaints (P7-10) ──────────────────────────────────────────────────
 *
 * One thread per order, authorised by the same receipt token the tracking
 * screen already holds. Everything here is tolerant in the house style:
 * nothing throws, every field is read defensively, and an unknown status
 * renders as itself rather than blanking the thread.
 */

/** open → answered (restaurant replied) → resolved. Widened, because the
 *  server owns this machine and may grow a state after this build. */
export type ApiIssueStatus = "open" | "answered" | "resolved" | (string & {});

export interface ApiIssueMessage {
  id: string;
  /** Who wrote it. Anything the app doesn't recognise is shown as the
   *  restaurant, never as the guest — attributing a stranger's words to
   *  the guest is the worse mistake. */
  author: "guest" | "restaurant";
  body: string;
  /** Absolute, token-carrying URL of the attached photo; null when the
   *  message has none. */
  photoUrl: string | null;
  createdAt: string;
}

export interface ApiIssue {
  id: string;
  orderId: string;
  status: ApiIssueStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Oldest first, as the server sends them. */
  messages: ApiIssueMessage[];
}

export interface ApiIssueState {
  /** May the guest open a thread right now? An EXISTING thread stays
   *  usable even when this is false — the window only gates creation. */
  canReport: boolean;
  /** ISO; when the reporting window closes. */
  windowEndsAt: string;
  issue: ApiIssue | null;
}

/** Everything a guest post can be refused for, plus the transport's own
 *  failure. One union so the sheet has a single thing to translate. */
export type IssuePostError =
  | "window_closed"
  | "resolved"
  | "too_large"
  | "invalid_photo"
  | "invalid"
  | "invalid_token"
  | "not_found"
  /** The route is rate-limited per IP; a shared café Wi-Fi can hit it. */
  | "rate_limited"
  | "network";

const ISSUE_ERRORS: readonly IssuePostError[] = [
  "window_closed",
  "resolved",
  "too_large",
  "invalid_photo",
  "invalid",
  "invalid_token",
  "not_found",
  "rate_limited",
  "network",
];

/** Anything the server names that this build doesn't know becomes the
 *  generic "invalid" — a wrong message beats a blank one. */
function asIssueError(raw: unknown): IssuePostError {
  return ISSUE_ERRORS.includes(raw as IssuePostError) ? (raw as IssuePostError) : "invalid";
}

function asIssueSummary(raw: unknown): { status: string; updatedAt: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  if (typeof i.status !== "string" || !i.status) return null;
  return { status: i.status, updatedAt: typeof i.updatedAt === "string" ? i.updatedAt : "" };
}

function asIssueMessage(raw: unknown): ApiIssueMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === "string" ? m.id : "";
  if (!id) return null;
  return {
    id,
    author: m.author === "guest" ? "guest" : "restaurant",
    body: typeof m.body === "string" ? m.body : "",
    // Dev/CI serves photos off our own origin, which an Android emulator
    // reaches on 10.0.2.2 — same rebase as every other image URL.
    photoUrl: typeof m.photoUrl === "string" && m.photoUrl ? rebaseUrl(m.photoUrl) : null,
    createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
  };
}

export function asIssue(raw: unknown): ApiIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  const id = typeof i.id === "string" ? i.id : "";
  if (!id) return null;
  return {
    id,
    orderId: typeof i.orderId === "string" ? i.orderId : "",
    status: typeof i.status === "string" ? i.status : "open",
    createdAt: typeof i.createdAt === "string" ? i.createdAt : "",
    updatedAt: typeof i.updatedAt === "string" ? i.updatedAt : "",
    resolvedAt: typeof i.resolvedAt === "string" ? i.resolvedAt : null,
    messages: Array.isArray(i.messages)
      ? i.messages.map(asIssueMessage).filter((m): m is ApiIssueMessage => m !== null)
      : [],
  };
}

/**
 * The thread on this order, and whether the guest may still start one.
 *
 * Null for every "nothing to show" case — a bad token, an order this
 * device no longer owns, offline, a server without the route — so the
 * caller has one thing to check. Never throws.
 */
export async function fetchIssue(orderId: string, token: string): Promise<ApiIssueState | null> {
  if (!orderId || !token) return null;
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/orders/${encodeURIComponent(orderId)}/issue?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || body.ok !== true) return null;
    return {
      canReport: body.canReport === true,
      windowEndsAt: typeof body.windowEndsAt === "string" ? body.windowEndsAt : "",
      issue: asIssue(body.issue),
    };
  } catch {
    return null;
  }
}

/**
 * Report a problem, or add to the thread already open on this order.
 *
 * With a photo the request is `multipart/form-data` — React Native's
 * `FormData` takes a `{ uri, name, type }` stand-in for a File and the
 * bridge streams the file off disk, so a 5 MB photo never passes through
 * JS. Without one it is plain JSON, which is cheaper and keeps the
 * text-only path working on web, where the RN file shape doesn't exist.
 *
 * `Content-Type` is deliberately NOT set on the multipart branch: the
 * runtime has to add its own boundary, and naming the type by hand is the
 * classic way to get a 400 the server can't explain.
 */
export async function postIssueMessage(
  orderId: string,
  token: string,
  body: string,
  photo?: { uri: string; name: string; type: string } | null,
): Promise<{ ok: true; issue: ApiIssue; created: boolean } | { ok: false; error: IssuePostError }> {
  try {
    const url = `${BASE_URL}/api/v1/orders/${encodeURIComponent(orderId)}/issue`;
    let res: Response;
    if (photo) {
      const form = new FormData();
      form.append("token", token);
      form.append("body", body);
      // The RN file descriptor: not a browser File, which is why this
      // cast exists at all.
      form.append("photo", photo as unknown as Blob);
      res = await fetch(url, { method: "POST", body: form });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, body }),
      });
    }
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !payload || payload.ok !== true) {
      // Prefer the server's own code; fall back to the status when it
      // sent none (a proxy's 413, say).
      const named = payload?.error;
      if (typeof named === "string") return { ok: false, error: asIssueError(named) };
      if (res.status === 429) return { ok: false, error: "rate_limited" };
      if (res.status === 413) return { ok: false, error: "too_large" };
      if (res.status === 401) return { ok: false, error: "invalid_token" };
      if (res.status === 404) return { ok: false, error: "not_found" };
      if (res.status === 403) return { ok: false, error: "window_closed" };
      if (res.status === 409) return { ok: false, error: "resolved" };
      return { ok: false, error: "invalid" };
    }
    const issue = asIssue(payload.issue);
    if (!issue) return { ok: false, error: "invalid" };
    return { ok: true, issue, created: payload.created === true };
  } catch {
    return { ok: false, error: "network" };
  }
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

/**
 * The venue's wallet setup, WITHOUT an order to pay for.
 *
 * `GET /api/v1/pay/wallet-config` answers the same publishable key the
 * PaymentIntent would carry — which is what lets the app initialise the
 * Stripe SDK before there is anything to charge. `publishableKey: null`
 * is the normal, safe answer (no Stripe account, a fake provider, a
 * Connect fee model): it means "no wallet button".
 *
 * Every failure — offline, a server that predates the route (404), a
 * body that isn't what we expect — collapses to the same null answer.
 * A guest opening the cart must never see an error because a wallet
 * probe could not reach the server.
 */
export interface WalletConfig {
  publishableKey: string | null;
  applePay: boolean;
  /** Merchant country for the payment request, e.g. "DE". */
  country: string;
}

export async function fetchWalletConfig(): Promise<WalletConfig> {
  const off: WalletConfig = { publishableKey: null, applePay: false, country: "DE" };
  try {
    const res = await fetch(`${BASE_URL}/api/v1/pay/wallet-config`);
    if (!res.ok) return off;
    const body = (await res.json().catch(() => null)) as Partial<WalletConfig> | null;
    if (!body) return off;
    return {
      publishableKey: typeof body.publishableKey === "string" ? body.publishableKey : null,
      applePay: body.applePay === true,
      country: typeof body.country === "string" && body.country ? body.country : "DE",
    };
  } catch {
    return off;
  }
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

/**
 * Start a PayPal payment and get the approve URL back, so the app can
 * open PayPal itself instead of our pay page with its button on it.
 * `appReturnUrl` is the deep link PayPal's return leg hands the browser
 * back on — without it the round trip ends on the web pay page.
 */
export async function startPaypal(
  orderId: string,
  token: string,
  appReturnUrl?: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/orders/${encodeURIComponent(orderId)}/pay/paypal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appReturnUrl ? { token, app: appReturnUrl } : { token }),
    });
    const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || typeof body?.url !== "string") {
      return { ok: false, error: String(body?.error ?? `http_${res.status}`) };
    }
    // Real PayPal is an absolute paypal.com URL and passes through; the
    // dev/CI fake answers with our own origin, which on an Android
    // emulator has to be rebased off localhost like any other link.
    return { ok: true, url: rebaseUrl(body.url) };
  } catch {
    return { ok: false, error: "network" };
  }
}

/**
 * Our own hosted pay page, as a fallback when the native sheet and the
 * provider-hosted checkout are both unavailable.
 *
 * `locale` matters: the page is fully server-rendered prose, and without
 * it a French guest is bounced to a German one (it falls back to the
 * venue's default locale). The page reads the same `?locale=` the menu
 * endpoint does.
 */
export function payPageUrl(
  orderId: string,
  token: string,
  appReturnUrl?: string,
  locale?: string,
): string {
  const app = appReturnUrl ? `&app=${encodeURIComponent(appReturnUrl)}` : "";
  const lang = locale ? `&locale=${encodeURIComponent(locale)}` : "";
  return `${BASE_URL}/pay/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}${app}${lang}`;
}

/** The receipt PDF is rendered server-side; `locale` picks the copy (the
 *  guest's app language, not the venue's). */
/* ── Guest password reset (P7-15) ────────────────────────────────────────
 *
 * One call from the app: "send whoever owns this address a link". The
 * route answers 200 whether or not an account exists — deliberately, so
 * the app can never be used to find out who has one — which is why there
 * is nothing to report back beyond "the request got through".
 *
 * The reset itself happens on the WEB page the emailed link opens; that
 * page hands the browser back to `appReturnUrl` when it is one of ours,
 * which is how the app learns the password changed.
 */
export async function requestPasswordReset(
  email: string,
  opts: { locale?: string; appReturnUrl?: string | null } = {},
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/customer/reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        ...(opts.locale ? { locale: opts.locale } : {}),
        ...(opts.appReturnUrl ? { appReturnUrl: opts.appReturnUrl } : {}),
      }),
    });
    // Anything but a clean 2xx (rate limit, malformed address, a server
    // that predates the route) is worth offering a retry for — the
    // neutral "check your email" would otherwise be a lie.
    return res.ok;
  } catch {
    return false;
  }
}

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
