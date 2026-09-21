import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { signInCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { GIFT_CARD_AMOUNT } from "@/lib/gift-card-config";
import { DEFAULT_GIFT_CARD_PRODUCTS, listGiftCardProducts } from "@/lib/gift-card-service";
import { asTenant } from "@/lib/tenant";
import { GET, OPTIONS, POST } from "./route";

/**
 * The guest side of gift cards, asserted at the wire level because the
 * mobile app codes against these exact keys.
 *
 * The claim worth defending here is that THE GUEST'S AMOUNT IS THE
 * CARD'S VALUE, and that it is bounded: the POST names a design and an
 * `amountCents`, the card is minted at that amount, the design's own
 * `priceCents` is only a suggestion, and anything outside
 * €5–€500-in-whole-euros is refused with a code the app can act on. The
 * card is still born `pending_payment` — unspendable until a payment
 * provider says otherwise. Runs on the fake Stripe provider
 * (vitest.setup strips the real keys), so the `payment` block is the
 * dev-sheet shape the app falls back to.
 */

interface ProductBody {
  ok: boolean;
  enabled?: boolean;
  expiryMonths?: number;
  currency?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  amountStepCents?: number;
  products?: { id: string; name: string; priceCents: number; active: boolean }[];
}

interface BuyBody {
  ok: boolean;
  error?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  card?: {
    id: string;
    code: string;
    codeFormatted: string;
    status: string;
    valueCents: number;
    recipientName: string | null;
    paidAt: string | null;
    expiresAt: string | null;
    shareUrl: string | null;
  };
  payment?: {
    mode: string;
    ref: string;
    clientSecret: string;
    publishableKey: string | null;
    amountCents: number;
    currency: string;
    merchantName: string;
  };
}

describe("/api/v1/gift-cards", () => {
  let tenantId: string;
  let userId: string;
  let venueId: string;
  let guestToken: string;
  let productId: string;

  const originalSlug = process.env.RESTAURANT_SLUG;
  // The buy limit is 12/minute per IP and its buckets outlive the
  // process — a per-run address keeps repeat runs off each other's.
  const ip = `10.11.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  function freshIp(): string {
    return `10.12.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  }

  beforeAll(async () => {
    const s = await signupUser({
      email: `gc-api-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Gift Card API Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;

    const slug = `gc-api-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venueId = await asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId,
          name: "Rangla Punjab",
          slug,
          currency: "EUR",
          timezone: "Europe/Berlin",
          giftCards: { enabled: true, expiryMonths: 36 },
        },
        select: { id: true },
      });
      return venue.id;
    });

    const guest = await signInCustomer(tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    guestToken = guest.token;
    productId = (await listGiftCardProducts(tenantId, venueId))[2]!.id; // Festmahl, €100
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.giftCard.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.giftCardProduct.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customerToken.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function buyRequest(body: unknown, token?: string, from = ip): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/gift-cards", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": from,
        ...(token ? { "x-customer-token": token } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("lists the venue's designs as a public shop window", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    // The app reads this before anyone signs in, and it changes only when
    // the owner edits a design — so it is cacheable, unlike everything
    // below it.
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = (await res.json()) as ProductBody;
    expect(body).toMatchObject({ ok: true, enabled: true, expiryMonths: 36, currency: "EUR" });
    // The amount picker's bounds travel with the shop window, so the app
    // never hard-codes them.
    expect(body).toMatchObject({
      minAmountCents: 500,
      maxAmountCents: 50000,
      amountStepCents: 100,
    });
    expect([body.minAmountCents, body.maxAmountCents, body.amountStepCents]).toEqual([
      GIFT_CARD_AMOUNT.minCents,
      GIFT_CARD_AMOUNT.maxCents,
      GIFT_CARD_AMOUNT.stepCents,
    ]);
    // Products keep `priceCents` — it is the SUGGESTED amount for that
    // design now, which the app shows as the field's placeholder.
    expect(body.products?.map((p) => [p.name, p.priceCents])).toEqual(
      DEFAULT_GIFT_CARD_PRODUCTS.map((p) => [p.name, p.priceCents]),
    );
  });

  it("401s a buy with no customer token", async () => {
    const res = await POST(buyRequest({ productId, amountCents: 4000 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    // The Expo web surface has to be able to READ the refusal.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    // And nothing was minted for an anonymous caller.
    expect(await asTenant(tenantId, (tx) => tx.giftCard.count())).toBe(0);
  });

  it("404s a product this venue does not sell", async () => {
    const res = await POST(
      buyRequest({ productId: "no-such-product", amountCents: 4000 }, guestToken),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "unknown_product" });
  });

  it("400s a body with no product at all", async () => {
    // Two fields missing, one of them the product: that is a client bug,
    // not a guest typo, so it keeps the generic refusal.
    const res = await POST(buyRequest({ recipientName: "Simran" }, guestToken));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
  });

  it("400s invalid_amount, with the bounds, when the amount is the only thing wrong", async () => {
    // Eight buys in one test would eat most of the 12/minute budget the
    // other cases share, so this one gets its own address.
    const from = freshIp();
    // Missing entirely — there is deliberately NO default, because
    // falling back to the design's suggestion would charge a guest whose
    // amount field failed to send.
    const missing = await POST(buyRequest({ productId }, guestToken, from));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      ok: false,
      error: "invalid_amount",
      minAmountCents: 500,
      maxAmountCents: 50000,
    });

    for (const amountCents of [
      400, // below €5
      0,
      -4000,
      50100, // above €500
      4763, // not a whole euro
      40.5, // not an integer number of cents
      "4000", // not a number at all
    ]) {
      const res = await POST(buyRequest({ productId, amountCents }, guestToken, from));
      expect(res.status, `amountCents=${String(amountCents)}`).toBe(400);
      const body = (await res.json()) as BuyBody;
      expect(body.error, `amountCents=${String(amountCents)}`).toBe("invalid_amount");
      expect([body.minAmountCents, body.maxAmountCents]).toEqual([500, 50000]);
      // The Expo web surface has to be able to READ the refusal.
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }

    // Nothing was minted on the way to any of those refusals.
    expect(await asTenant(tenantId, (tx) => tx.giftCard.count())).toBe(0);
  });

  it("accepts the bounds themselves — €5 and €500 are inside the range", async () => {
    const from = freshIp();
    for (const amountCents of [500, 50000]) {
      const res = await POST(buyRequest({ productId, amountCents }, guestToken, from));
      expect(res.status, `amountCents=${amountCents}`).toBe(201);
      const body = (await res.json()) as BuyBody;
      expect(body.card?.valueCents).toBe(amountCents);
      expect(body.payment?.amountCents).toBe(amountCents);
    }
    await asTenant(tenantId, (tx) => tx.giftCard.deleteMany({}));
  });

  it("mints an unpaid card at the GUEST'S amount, with a payment sheet to open", async () => {
    const res = await POST(
      buyRequest(
        // The €100 "Festmahl" design, bought for €40. The design's price
        // is a suggestion; this number is the card.
        { productId, amountCents: 4000, recipientName: "Simran", message: "Alles Gute!" },
        guestToken,
      ),
    );
    expect(res.status).toBe(201);
    // A card carries a bearer code: never cacheable, anywhere.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const body = (await res.json()) as BuyBody;
    expect(body.ok).toBe(true);
    expect(body.card).toMatchObject({
      status: "pending_payment",
      // €40, what the guest asked for — NOT the €10000 the Festmahl
      // design suggests.
      valueCents: 4000,
      recipientName: "Simran",
      paidAt: null,
      expiresAt: null,
      // Nothing to share until the money arrives.
      shareUrl: null,
    });
    expect(body.card?.codeFormatted).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    // No real Stripe here, so there is no publishable key to hand over —
    // the app reads this as "show the dev pay button, not Stripe's sheet".
    // Stripe is charged from the CARD's value, so the guest's amount
    // flows all the way to the payment sheet with no second source of
    // truth in between.
    expect(body.payment).toMatchObject({
      mode: "fake",
      publishableKey: null,
      amountCents: 4000,
      currency: "EUR",
      merchantName: "Rangla Punjab",
    });
    expect(body.payment?.ref).toMatch(/^pi_fake_/);
    expect(body.payment?.clientSecret).toBe(`${body.payment?.ref}_secret_test`);

    // The stored row agrees, and the intent's ref was stamped on it so the
    // return leg can find the card again.
    const row = await asTenant(tenantId, (tx) =>
      tx.giftCard.findFirstOrThrow({
        where: { id: body.card!.id },
        select: { status: true, valueCents: true, expiresAt: true, paymentRef: true },
      }),
    );
    expect(row).toMatchObject({
      status: "pending_payment",
      valueCents: 4000,
      expiresAt: null,
      paymentRef: body.payment!.ref,
    });
  });

  it("429s past the per-IP buy ceiling, with a Retry-After the app can honour", async () => {
    // Buying starts a payment, so the limit is tighter than a read's. It
    // is checked BEFORE authentication — an unauthenticated flood must
    // cost an attacker their budget too.
    const from = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 13; i += 1) {
      statuses.push(
        (await POST(buyRequest({ productId, amountCents: 4000 }, undefined, from))).status,
      );
    }
    expect(statuses.slice(0, 12).every((s) => s === 401)).toBe(true);

    const limited = await POST(buyRequest({ productId, amountCents: 4000 }, guestToken, from));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers the CORS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
