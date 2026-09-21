import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import {
  GIFT_CARD_AMOUNT,
  GIFT_CARD_PURCHASE_DISCOUNT_PERCENT,
  parseGiftCardConfig,
} from "@/lib/gift-card-config";
import { createGiftCardPayPalPayment, createGiftCardPaymentIntent } from "@/lib/gift-card-payment";
import { createGiftCardPurchase, listActiveGiftCardProducts } from "@/lib/gift-card-service";
import { payPalOnFor } from "@/lib/paypal";
import { getOperatorSettings } from "@/lib/operator-settings";
import { resolvePreviewContext } from "@/lib/preview-context";
import { checkRateLimit, type RateLimitConfig } from "@/lib/rate-limit";
import { getRestaurantSlug } from "@/lib/restaurant";
import { sanitizeAppReturnUrl } from "@/lib/app-return";
import { asTenant } from "@/lib/tenant";
import { getPayPalKeysForTenant } from "@/lib/tenant-payment-keys";

/**
 * Gift cards, guest side.
 *
 *   GET  — the venue's active card designs. Public: it is a shop window,
 *          and the app needs it before the guest signs in so the Home
 *          screen knows whether to show the entry at all.
 *   POST — buy one. Signed-in only, because a card has to land in an
 *          account the buyer can come back to; the card itself is a
 *          bearer instrument they can then give away.
 *
 * THE GUEST CHOOSES THE AMOUNT. The POST names a design AND an
 * `amountCents`; the design contributes artwork and a name, the amount
 * becomes the card's `valueCents`, and the product's own `priceCents` is
 * only the SUGGESTION the app shows as a placeholder. A client-named
 * price is safe here in a way it never is for goods: a gift card is
 * stored value, so the guest is charged exactly what they are issued,
 * and the charge is built downstream from the stored `valueCents` rather
 * than from anything the client sends twice. The bounds in
 * `GIFT_CARD_AMOUNT` are the whole of the protection, and they are
 * enforced twice — here for a precise error, and again inside
 * `createGiftCardPurchase` so no other caller can skip them.
 *
 * The card is still minted `pending_payment`, and only the payment
 * provider's confirmation activates it.
 */

/** Buying is a write that starts a payment — tighter than a read, and
 *  fail-open so a Redis blip cannot block a sale. */
const BUY_IP: RateLimitConfig = {
  scope: "giftcard-buy:ip",
  limit: 12,
  windowSec: 60,
  failOpen: true,
};

/** The refusal the app puts under the contact-number box. */
function invalidPhone(): NextResponse {
  return withCors(NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 }));
}

/** The refusal the app renders as "pick an amount between €5 and €500". */
function invalidAmount(): NextResponse {
  return withCors(
    NextResponse.json(
      {
        ok: false,
        error: "invalid_amount",
        minAmountCents: GIFT_CARD_AMOUNT.minCents,
        maxAmountCents: GIFT_CARD_AMOUNT.maxCents,
      },
      { status: 400 },
    ),
  );
}

const buySchema = z.object({
  productId: z.string().min(1).max(64),
  /**
   * What the guest wants on the card, in cents. REQUIRED — there is no
   * default, because falling back to the design's suggested price would
   * silently charge a guest whose amount field failed to send.
   */
  amountCents: z
    .number()
    .int()
    .min(GIFT_CARD_AMOUNT.minCents)
    .max(GIFT_CARD_AMOUNT.maxCents)
    .refine((v) => v % GIFT_CARD_AMOUNT.stepCents === 0),
  /**
   * The buyer's contact number — REQUIRED (owner decision 2026-09-21), so
   * the restaurant can reach whoever paid. Any spelling a guest types
   * ("0 7531 …", "+49 …"); the service normalises it to E.164 and refuses
   * anything that is not a phone number.
   */
  phone: z.string().trim().min(1).max(40),
  /** Whose name goes on the card. The buyer's words, shown verbatim. */
  recipientName: z.string().trim().max(80).optional(),
  message: z.string().trim().max(500).optional(),
  /** Which payment sheet to open. `card` is Stripe (native or fake). */
  method: z.enum(["card", "paypal"]).default("card"),
  /** Deep link back into the app after a PayPal round trip. */
  app: z.string().max(512).optional(),
});

async function venueContext(): Promise<{ tenantId: string; venueId: string } | null> {
  return resolvePreviewContext(await getRestaurantSlug(), null);
}

export async function GET(): Promise<NextResponse> {
  const ctx = await venueContext();
  if (!ctx) {
    return withCors(NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 }));
  }

  const venue = await asTenant(ctx.tenantId, (tx) =>
    tx.venue.findFirst({
      where: { id: ctx.venueId },
      select: { giftCards: true, currency: true },
    }),
  );
  const config = parseGiftCardConfig(venue?.giftCards);
  const products = await listActiveGiftCardProducts(ctx.tenantId, ctx.venueId, config);

  return withCors(
    NextResponse.json(
      {
        ok: true,
        enabled: config.enabled && products.length > 0,
        expiryMonths: config.expiryMonths,
        currency: venue?.currency ?? "EUR",
        // The amount picker's bounds, so the app never has to hard-code
        // them and a change here reaches every installed build at once.
        // Each product's `priceCents` is the SUGGESTED amount for that
        // design — the app shows it as the field's placeholder.
        minAmountCents: GIFT_CARD_AMOUNT.minCents,
        maxAmountCents: GIFT_CARD_AMOUNT.maxCents,
        amountStepCents: GIFT_CARD_AMOUNT.stepCents,
        // The guest pays this much less than the card's value; the app
        // shows the discounted price next to the amount they type.
        purchaseDiscountPercent: GIFT_CARD_PURCHASE_DISCOUNT_PERCENT,
        products,
      },
      // Short public cache: the shop window changes when the owner edits
      // a product, which is rare, and the app re-reads it on every open.
      { headers: { "Cache-Control": "public, max-age=60" } },
    ),
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(BUY_IP, clientIp(req));
  if (!rl.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    );
  }

  // The same kill switch ordering respects — a paused site must not take
  // money for anything.
  if (!(await getOperatorSettings()).siteActive) {
    return withCors(NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 }));
  }

  const auth = await authenticateCustomer(req);
  if (!auth.ok) {
    const status = auth.reason === "unavailable" ? 503 : 401;
    const error = auth.reason === "unavailable" ? "unavailable" : "unauthorized";
    return withCors(NextResponse.json({ ok: false, error }, { status }));
  }

  const ctx = await venueContext();
  if (!ctx || ctx.tenantId !== auth.tenantId) {
    return withCors(NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 }));
  }

  const parsed = buySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // A body whose ONLY fault is the amount gets the specific code and
    // the bounds, because that is the one field a guest typed and the
    // app has to explain. Anything else is a client bug, not a guest
    // mistake, and keeps the generic refusal it has always returned.
    const amountOnly = parsed.error.issues.every((i) => i.path[0] === "amountCents");
    if (amountOnly) return invalidAmount();
    // Same for the contact number — a missing or empty one is the guest's
    // to fix, so it gets its own code.
    const phoneOnly = parsed.error.issues.every((i) => i.path[0] === "phone");
    if (phoneOnly) return invalidPhone();
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }
  const input = parsed.data;

  if (input.method === "paypal" && !payPalOnFor(await getPayPalKeysForTenant(auth.tenantId))) {
    return withCors(NextResponse.json({ ok: false, error: "not_available" }, { status: 409 }));
  }

  const created = await createGiftCardPurchase(
    auth.tenantId,
    ctx.venueId,
    auth.customer.id,
    input.productId,
    {
      amountCents: input.amountCents,
      phone: input.phone,
      recipientName: input.recipientName,
      message: input.message,
    },
  );
  if (!created.ok) {
    // The service re-checks the bounds; if it is the one to refuse, the
    // guest still gets the same shape they would have got from zod.
    if (created.error === "invalid_amount") return invalidAmount();
    if (created.error === "invalid_phone") return invalidPhone();
    const status = created.error === "unknown_product" ? 404 : 409;
    return withCors(NextResponse.json({ ok: false, error: created.error }, { status }));
  }

  // The card exists and is unpaid; now start the money. A failure here
  // leaves a `pending_payment` row behind, which is correct — it is
  // never spendable, never counted as sold, and the guest can retry.
  if (input.method === "paypal") {
    const pay = await createGiftCardPayPalPayment(
      auth.tenantId,
      created.card.id,
      sanitizeAppReturnUrl(input.app),
    );
    if (!pay.ok) {
      return withCors(NextResponse.json({ ok: false, error: pay.error }, { status: 409 }));
    }
    return withCors(
      NextResponse.json(
        { ok: true, card: created.card, paypal: { url: pay.url } },
        { status: 201, headers: { "Cache-Control": "private, no-store" } },
      ),
    );
  }

  const intent = await createGiftCardPaymentIntent(auth.tenantId, created.card.id);
  if (!intent.ok) {
    return withCors(
      NextResponse.json(
        { ok: false, error: intent.error, card: created.card },
        { status: intent.error === "not_found" ? 404 : 409 },
      ),
    );
  }

  return withCors(
    NextResponse.json(
      {
        ok: true,
        card: created.card,
        payment: {
          mode: intent.mode,
          ref: intent.ref,
          clientSecret: intent.clientSecret,
          publishableKey: intent.publishableKey,
          amountCents: intent.amountCents,
          currency: intent.currency,
          merchantName: intent.merchantName,
        },
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}

export function OPTIONS(): NextResponse {
  return corsPreflight();
}
