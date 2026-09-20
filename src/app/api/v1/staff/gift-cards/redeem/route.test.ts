import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { signInCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { formatGiftCardCode, generateGiftCardCode } from "@/lib/gift-card-code";
import { asTenant } from "@/lib/tenant";
import { signSession } from "@/lib/session";
import { OPTIONS, POST } from "./route";

/**
 * Taking a gift card at the counter, from the restaurant app.
 *
 * The thing under test is the REFUSAL VOCABULARY. A cashier holding a
 * phone in front of a guest has to be able to say WHICH thing is wrong —
 * expired, already used, not paid for — and the split between 404 ("check
 * what you typed") and 409 ("the card is real, here is its story") is
 * what the app branches on to say it. Collapsing any of these into a
 * generic error turns a ten-second conversation into an argument.
 */

interface RedeemBody {
  ok: boolean;
  error?: string;
  card?: {
    id: string;
    status: string;
    valueCents: number;
    codeFormatted: string;
    redemption: { kind: string; note: string | null; staffName: string | null } | null;
  };
}

describe("POST /api/v1/staff/gift-cards/redeem", () => {
  let tenantId: string;
  let userId: string;
  let venueId: string;
  let customerId: string;
  let staffToken: string;
  let guestToken: string;

  const originalSlug = process.env.RESTAURANT_SLUG;
  const ip = `10.13.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `gc-redeem-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Redeem Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    staffToken = signSession(userId);

    const slug = `gc-redeem-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venueId = await asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId, name: "Rangla Punjab", slug, currency: "EUR", timezone: "Europe/Berlin" },
        select: { id: true },
      });
      return venue.id;
    });

    const guest = await signInCustomer(tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    customerId = guest.customerId;
    guestToken = guest.token;
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

  /** A card in whatever state the test needs. Written straight to the
   *  table: how a card is sold is `gift-card-service.test.ts`'s problem. */
  async function card(
    overrides: { status?: string; expiresAt?: Date | null; paidAt?: Date | null } = {},
  ): Promise<string> {
    const code = generateGiftCardCode();
    await asTenant(tenantId, (tx) =>
      tx.giftCard.create({
        data: {
          tenantId,
          venueId,
          code,
          purchaserCustomerId: customerId,
          valueCents: 5000,
          currency: "EUR",
          status: overrides.status ?? "active",
          paidAt: overrides.paidAt === undefined ? new Date() : overrides.paidAt,
          expiresAt:
            overrides.expiresAt === undefined
              ? new Date(Date.now() + 86_400_000)
              : overrides.expiresAt,
        },
      }),
    );
    return code;
  }

  function request(body: unknown, token: string | null): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/staff/gift-cards/redeem", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(token ? { "x-staff-token": token } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  // `null` means "send no credential at all" — deliberately not
  // `undefined`, which would fall through to the staff token below.
  async function redeem(body: unknown, token: string | null = staffToken) {
    const res = await POST(request(body, token));
    return { status: res.status, body: (await res.json()) as RedeemBody, headers: res.headers };
  }

  it("401s without a staff token, and refuses a guest's token as one", async () => {
    const code = await card();
    for (const token of [null, guestToken]) {
      const res = await redeem({ code }, token);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: "unauthorized" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    // The card the anonymous caller named is untouched.
    const row = await asTenant(tenantId, (tx) =>
      tx.giftCard.findFirstOrThrow({ where: { code }, select: { status: true } }),
    );
    expect(row.status).toBe("active");
  });

  it("400s a body with no usable code", async () => {
    expect(await redeem({})).toMatchObject({ status: 400, body: { ok: false, error: "invalid" } });
    expect(await redeem({ code: "ab" })).toMatchObject({ status: 400 });
  });

  it("takes an active card and answers with the redeemed card", async () => {
    const code = await card();
    // Sent the way a cashier types it: dashed and lower case.
    const res = await redeem({ code: formatGiftCardCode(code).toLowerCase(), note: "table 7" });

    expect(res.status).toBe(200);
    // A bearer code in the body — never cacheable.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.body.ok).toBe(true);
    expect(res.body.card).toMatchObject({
      status: "redeemed",
      valueCents: 5000,
      codeFormatted: formatGiftCardCode(code),
    });
    expect(res.body.card?.redemption).toMatchObject({ kind: "counter", note: "table 7" });

    // The till's record: who took it, and that no order was involved.
    const row = await asTenant(tenantId, (tx) =>
      tx.giftCard.findFirstOrThrow({
        where: { code },
        select: { status: true, redeemedByUserId: true, redeemedOrderId: true },
      }),
    );
    expect(row).toMatchObject({
      status: "redeemed",
      redeemedByUserId: userId,
      redeemedOrderId: null,
    });
  });

  it("404s a code we have never issued — 'check what you typed'", async () => {
    const res = await redeem({ code: generateGiftCardCode() });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "unknown" });

    // A near-miss (one character short) must fail loudly rather than
    // quietly look up a different card.
    const short = await redeem({ code: generateGiftCardCode().slice(0, 11) });
    expect(short.status).toBe(404);
    expect(short.body).toEqual({ ok: false, error: "unknown" });
  });

  it("409s each named refusal on a card that is real but unspendable", async () => {
    const spent = await card();
    expect((await redeem({ code: spent })).status).toBe(200);

    const cases: [string, string][] = [
      // Bought but abandoned at the payment sheet: never sold, never spendable.
      ["not_paid", await card({ status: "pending_payment", paidAt: null, expiresAt: null })],
      // Already taken — at this till or another one.
      ["already_redeemed", spent],
      ["refunded", await card({ status: "refunded" })],
      // Lazy expiry: nothing flipped this beforehand, the date simply passed.
      ["expired", await card({ expiresAt: new Date(Date.now() - 60_000) })],
    ];

    for (const [error, code] of cases) {
      const res = await redeem({ code });
      expect(res.status, error).toBe(409);
      expect(res.body, error).toEqual({ ok: false, error });
      expect(res.headers.get("access-control-allow-origin"), error).toBe("*");
    }
  });

  it("answers the CORS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
