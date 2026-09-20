import { BASE_URL, rebaseUrl } from "./api";

/**
 * Gift cards, guest side — the shop window, the purchase, and the cards
 * this account has bought.
 *
 * Same posture as `api.ts`: nothing throws, every field is read
 * defensively (the server owns the lifecycle and may grow a status after
 * this build shipped), money stays in integer cents, and a discriminated
 * union comes back rather than an exception.
 *
 * A gift card is a BEARER instrument: the code IS the value. That is why
 * `/api/v1/me/gift-cards` is honestly "cards you bought" rather than
 * "cards you hold" — there is no owner column to read — and why the cart
 * will happily spend a code someone else's account paid for.
 */

/** The lifecycle this build knows. Widened, because the server owns it. */
export type GiftCardStatus =
  "pending_payment" | "active" | "redeemed" | "expired" | "refunded" | (string & {});

/**
 * How a card was spent, or null while it still has its value.
 *
 * Two shapes because they are two different stories to tell the buyer:
 * someone handed it over at the counter (and a named person took it), or
 * it paid for an order in the app.
 */
export type GiftCardRedemption =
  | { kind: "counter"; at: string; staffName: string | null; note: string | null }
  | { kind: "order"; at: string; orderNumber: number | null }
  | null;

export interface GiftCardProduct {
  id: string;
  name: string;
  priceCents: number;
  /** Absolute, and already rebased for the emulator. */
  imageUrl: string | null;
  imageKey: string | null;
  active: boolean;
  sortIndex: number;
}

export interface GiftCardView {
  id: string;
  /** Canonical, undashed. `codeFormatted` is what a human reads. */
  code: string;
  codeFormatted: string;
  productName: string | null;
  valueCents: number;
  currency: string;
  status: GiftCardStatus;
  recipientName: string | null;
  message: string | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  /** When the share link was FIRST opened — the middle step of the
   *  timeline ("they've seen it"). Null until someone opens it. */
  sharedAt: string | null;
  redemption: GiftCardRedemption;
  imageUrl: string | null;
  /** The link the buyer forwards. Null until the card is paid for — an
   *  unpaid card has nothing to share. */
  shareUrl: string | null;
}

/** The venue's shop window. */
export interface GiftCardShop {
  enabled: boolean;
  expiryMonths: number;
  currency: string;
  products: GiftCardProduct[];
}

/** What `POST /api/v1/gift-cards` hands back to pay with. Identical in
 *  shape to the order flow's `PaymentIntentInfo`, deliberately: the same
 *  sheet drives both. */
export interface GiftCardPayment {
  mode: "real" | "fake";
  ref: string;
  clientSecret: string;
  publishableKey: string | null;
  amountCents: number;
  currency: string;
  merchantName: string;
}

export interface GiftCardPurchase {
  card: GiftCardView;
  /** Card / wallet route. Absent when the guest chose PayPal. */
  payment: GiftCardPayment | null;
  /** PayPal's own approve URL. Absent on the card route. */
  paypalUrl: string | null;
}

/**
 * Why a purchase could not start, in the server's own words.
 *
 * Kept as the raw string rather than an enum: the screen maps the ones
 * it has copy for and falls back to "that didn't go through" for
 * anything a newer server invents.
 */
export type GiftCardBuyError =
  | "unauthorized"
  | "disabled"
  | "code_exhausted"
  | "not_available"
  | "unknown_product"
  | "rate_limited"
  | "network"
  | (string & {});

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asRedemption(raw: unknown): GiftCardRedemption {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const at = str(r.at);
  if (!at) return null;
  if (r.kind === "order") {
    return {
      kind: "order",
      at,
      orderNumber: typeof r.orderNumber === "number" ? r.orderNumber : null,
    };
  }
  // Anything else is the counter shape: a card that was handed over is
  // the safer reading than "we don't know what happened to it".
  return { kind: "counter", at, staffName: nullableStr(r.staffName), note: nullableStr(r.note) };
}

export function asGiftCard(raw: unknown): GiftCardView | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = str(c.id);
  const code = str(c.code);
  if (!id || !code) return null;
  return {
    id,
    code,
    // A server that predates the formatted form still gives us something
    // readable rather than a blank line on the card.
    codeFormatted: str(c.codeFormatted) || groupCode(code),
    productName: nullableStr(c.productName),
    valueCents: num(c.valueCents),
    currency: str(c.currency, "EUR"),
    status: str(c.status, "pending_payment"),
    recipientName: nullableStr(c.recipientName),
    message: nullableStr(c.message),
    createdAt: str(c.createdAt),
    paidAt: nullableStr(c.paidAt),
    expiresAt: nullableStr(c.expiresAt),
    sharedAt: nullableStr(c.sharedAt),
    redemption: asRedemption(c.redemption),
    imageUrl: rebaseUrl(nullableStr(c.imageUrl)),
    shareUrl: rebaseUrl(nullableStr(c.shareUrl)),
  };
}

function asProduct(raw: unknown): GiftCardProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = str(p.id);
  if (!id) return null;
  return {
    id,
    name: str(p.name),
    priceCents: num(p.priceCents),
    imageUrl: rebaseUrl(nullableStr(p.imageUrl)),
    imageKey: nullableStr(p.imageKey),
    active: p.active !== false,
    sortIndex: num(p.sortIndex),
  };
}

/** "ABCD-EFGH-JKMN" from "ABCDEFGHJKMN" — the display grouping, mirrored
 *  from the server's `formatGiftCardCode` for the fallback above. */
function groupCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join("-");
}

/**
 * The venue's card designs. Public, so it can be read before the guest
 * signs in — the Home screen needs to know whether the entry exists at
 * all, and that decision must not wait for an account.
 *
 * Null for every "no shop" case (offline, a server without the route, a
 * venue with the feature off), so callers have one thing to check.
 */
export async function fetchGiftCardShop(): Promise<GiftCardShop | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/gift-cards`);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || body.ok !== true) return null;
    const products = (Array.isArray(body.products) ? body.products : [])
      .map(asProduct)
      .filter((p): p is GiftCardProduct => p !== null && p.active)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    return {
      enabled: body.enabled === true && products.length > 0,
      expiryMonths: num(body.expiryMonths, 12),
      currency: str(body.currency, "EUR"),
      products,
    };
  } catch {
    return null;
  }
}

export interface BuyGiftCardInput {
  productId: string;
  recipientName?: string;
  message?: string;
  method: "card" | "paypal";
  /** Deep link PayPal's return leg hands the browser back on. */
  app?: string;
}

/**
 * Buy a card. The card is minted `pending_payment` and only the payment
 * provider's confirmation activates it — so a failed payment leaves a
 * row nobody can spend, never a free gift card.
 */
export async function buyGiftCard(
  token: string | null,
  input: BuyGiftCardInput,
): Promise<{ ok: true; purchase: GiftCardPurchase } | { ok: false; error: GiftCardBuyError }> {
  if (!token) return { ok: false, error: "unauthorized" };
  try {
    const res = await fetch(`${BASE_URL}/api/v1/gift-cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Customer-Token": token },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const card = asGiftCard(body?.card);
    if (!res.ok || body?.ok !== true || !card) {
      return { ok: false, error: str(body?.error, `http_${res.status}`) };
    }
    const rawPayment = body.payment as Record<string, unknown> | undefined;
    const payment: GiftCardPayment | null =
      rawPayment && typeof rawPayment.clientSecret === "string"
        ? {
            mode: rawPayment.mode === "fake" ? "fake" : "real",
            ref: str(rawPayment.ref),
            clientSecret: rawPayment.clientSecret,
            publishableKey: nullableStr(rawPayment.publishableKey),
            amountCents: num(rawPayment.amountCents),
            currency: str(rawPayment.currency, "eur"),
            merchantName: str(rawPayment.merchantName),
          }
        : null;
    const paypal = body.paypal as Record<string, unknown> | undefined;
    return {
      ok: true,
      purchase: {
        card,
        payment,
        // The dev/CI fake answers with our own origin, which an Android
        // emulator has to reach off 10.0.2.2 like every other link.
        paypalUrl: rebaseUrl(nullableStr(paypal?.url)),
      },
    };
  } catch {
    return { ok: false, error: "network" };
  }
}

/**
 * Settles a FAKE gift-card intent — the twin of `confirmFakePayment` for
 * orders, and just as unreachable against a real Stripe account: the
 * server refuses this route outright unless the provider is the dev one.
 */
export async function confirmFakeGiftCardPayment(
  token: string | null,
  cardId: string,
  ref: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/gift-cards/${encodeURIComponent(cardId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Customer-Token": token },
      body: JSON.stringify({ ref }),
    });
    const body = (await res.json().catch(() => null)) as { paid?: boolean } | null;
    return res.ok && body?.paid === true;
  } catch {
    return false;
  }
}

/**
 * Every card this account has bought, newest first.
 *
 * Empty for every "nothing to show" case — signed out, 401, offline, a
 * server without the route — so the list simply renders its empty state
 * rather than an error. Never throws.
 */
export async function fetchMyGiftCards(token: string | null): Promise<GiftCardView[]> {
  if (!token) return [];
  try {
    const res = await fetch(`${BASE_URL}/api/v1/me/gift-cards`, {
      headers: { "X-Customer-Token": token },
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.ok !== true || !Array.isArray(body.cards)) return [];
    return body.cards.map(asGiftCard).filter((c): c is GiftCardView => c !== null);
  } catch {
    return [];
  }
}

/**
 * The card's QR, as a PNG this app can put in an `<Image>`.
 *
 * There is no QR RENDERER in this build on purpose:
 * `react-native-qrcode-svg` is not a dependency, and pulling in a native
 * module for one screen would force a rebuild of both binaries. The
 * server already draws the same PNG for the zero-JS share page, so the
 * app fetches that instead.
 *
 * The route is token-authorised — without it, it would be a code oracle
 * answering "does this card exist?" a few million times — and the token
 * is the `?t=` already inside the card's own `shareUrl`. Null whenever
 * there is no share URL yet (an unpaid card), which is exactly when
 * there is no QR to show.
 */
export function giftCardQrUrl(card: GiftCardView): string | null {
  if (!card.shareUrl) return null;
  const token = /[?&]t=([^&]+)/.exec(card.shareUrl)?.[1];
  if (!token) return null;
  return `${BASE_URL}/api/gift-cards/${encodeURIComponent(card.codeFormatted)}/qr?t=${token}`;
}

/**
 * The last four characters of a code, for the cart's "Gift card ····1234"
 * line BEFORE the server has answered.
 *
 * Mirrors `order-service.ts`, which takes the last four of the NORMALISED
 * code — so the separators and the Crockford confusables (I/L → 1, O → 0)
 * have to come out first, or a guest who typed "abcd efgh jkm-o" would be
 * shown a different four characters than the receipt carries. The
 * server's own `giftCardLast4` replaces this the moment it lands.
 */
export function giftCardLast4(code: string): string {
  return normalizeGiftCardCode(code).slice(-4);
}

/**
 * The canonical form of whatever was typed, pasted or scanned —
 * mirroring the server's `normalizeGiftCardCode` so the app can match a
 * typed code against the guest's own cards without a round trip.
 *
 * Accepts a whole share URL (someone copies the link rather than the
 * code), spaces, dashes and lower case, and applies Crockford's three
 * substitutions — I and L are 1, O is 0. Nothing more: guessing at S/5
 * would make two distinct valid codes collide.
 *
 * This is for MATCHING and for display only. The server normalises again
 * and owns whether the code is real.
 */
export function normalizeGiftCardCode(input: string): string {
  const raw = /\/gift-cards\/([^/?#]+)/i.exec(input.trim())?.[1] ?? input.trim();
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/** A card whose value can still be spent. The cart offers only these. */
export function isSpendable(card: GiftCardView): boolean {
  return card.status === "active";
}
