import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { corsPreflight, withCors } from "@/lib/cors";
import { authenticateCustomer } from "@/lib/customer-request";
import { parseGiftCardConfig } from "@/lib/gift-card-config";
import { createGiftCardPayPalPayment, createGiftCardPaymentIntent } from "@/lib/gift-card-payment";
import { createGiftCardPurchase, listActiveGiftCardProducts } from "@/lib/gift-card-service";
import { paypalAvailable } from "@/lib/paypal";
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
 * Money never comes from the request. The POST names a product; the
 * price is read from that product's row, the card is minted
 * `pending_payment`, and only the payment provider's confirmation
 * activates it.
 */

/** Buying is a write that starts a payment — tighter than a read, and
 *  fail-open so a Redis blip cannot block a sale. */
const BUY_IP: RateLimitConfig = {
  scope: "giftcard-buy:ip",
  limit: 12,
  windowSec: 60,
  failOpen: true,
};

const buySchema = z.object({
  productId: z.string().min(1).max(64),
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
    return withCors(NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }));
  }
  const input = parsed.data;

  if (
    input.method === "paypal" &&
    !paypalAvailable((await getPayPalKeysForTenant(auth.tenantId)).enabled)
  ) {
    return withCors(NextResponse.json({ ok: false, error: "not_available" }, { status: 409 }));
  }

  const created = await createGiftCardPurchase(
    auth.tenantId,
    ctx.venueId,
    auth.customer.id,
    input.productId,
    { recipientName: input.recipientName, message: input.message },
  );
  if (!created.ok) {
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
