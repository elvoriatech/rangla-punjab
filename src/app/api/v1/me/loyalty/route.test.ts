import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signupUser } from "@/lib/auth-service";
import { signInCustomer } from "@/lib/customer-auth";
import { prisma } from "@/lib/db";
import { creditOrderIfEligible } from "@/lib/loyalty-service";
import { placeOrder } from "@/lib/order-service";
import { asTenant } from "@/lib/tenant";
import { POST as ARM } from "./vouchers/[id]/arm/route";
import { GET } from "./route";

/**
 * The loyalty half of `/api/v1/me`. Asserted at the wire level because
 * the mobile app codes against these exact keys — a silent rename here is
 * a shipped app that shows a guest zero points.
 */

interface LoyaltyBody {
  ok: boolean;
  error?: string;
  loyalty?: {
    enabled: boolean;
    balance: number;
    rewardPoints: number;
    rewardValueCents: number;
    minOrderCents: number;
    pointsPerOrder: number;
    vouchers: {
      id: string;
      valueCents: number;
      status: string;
      expiresAt: string;
      redeemedOrderNumber: number | null;
    }[];
    history: {
      id: string;
      delta: number;
      reason: string;
      orderNumber: number | null;
      valueCents: number | null;
    }[];
  };
  voucher?: { id: string; valueCents: number; status: string; expiresAt: string };
}

describe("/api/v1/me/loyalty", () => {
  let tenantId: string;
  let userId: string;
  let venue: { tenantId: string; venueId: string; publishedVersionId: string; itemId: string };
  const originalSlug = process.env.RESTAURANT_SLUG;
  // Per-run IP so the arm endpoint's Redis bucket is never shared with an
  // earlier run of this suite.
  const ip = `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    const s = await signupUser({
      email: `loy-api-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Loyalty API Test",
    });
    if (!s.ok) throw new Error("signup failed");
    tenantId = s.tenantId;
    userId = s.userId;
    const slug = `loy-api-${randomUUID().slice(0, 8)}`;
    process.env.RESTAURANT_SLUG = slug;

    venue = await asTenant(tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan: "scale" } });
      const v = await tx.venue.create({
        data: {
          tenantId,
          name: "Loyalty Venue",
          slug,
          currency: "EUR",
          // 5 points an order, 5 for a reward: one qualifying order mints
          // a voucher, which is what the arm tests need.
          loyalty: {
            enabled: true,
            minOrderCents: 2000,
            pointsPerOrder: 5,
            rewardPoints: 5,
            rewardValueCents: 2000,
            voucherExpiryMonths: 0,
          },
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId, venueId: v.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const version = await tx.menuVersion.create({
        data: { tenantId, menuId: menu.id, status: "published", publishedAt: new Date() },
        select: { id: true },
      });
      await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
      const cat = await tx.category.create({
        data: { tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
        select: { id: true },
      });
      const item = await tx.item.create({
        data: { tenantId, categoryId: cat.id, name: "Dal", priceCents: 1200, orderIndex: 0 },
        select: { id: true },
      });
      return { tenantId, venueId: v.id, publishedVersionId: version.id, itemId: item.id };
    });
  });

  afterAll(async () => {
    if (originalSlug === undefined) delete process.env.RESTAURANT_SLUG;
    else process.env.RESTAURANT_SLUG = originalSlug;
    await asTenant(tenantId, (tx) => tx.loyaltyLedger.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.loyaltyVoucher.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.orderItem.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.order.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.customer.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantId, (tx) => tx.tenant.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function request(token: string, body?: unknown): NextRequest {
    return new NextRequest("http://localhost:3000/api/v1/me/loyalty", {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "x-customer-token": token,
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function signIn(): Promise<{ customerId: string; token: string }> {
    const s = await signInCustomer(tenantId, "dev", {
      sub: `dev:${randomUUID()}@ex.com`,
      email: `guest-${randomUUID().slice(0, 8)}@ex.com`,
      name: "Guest",
    });
    return { customerId: s.customerId, token: s.token };
  }

  /** One qualifying order, credited — enough to mint a voucher here. */
  async function earnOne(customerId: string): Promise<void> {
    const placed = await placeOrder(
      venue,
      { orderType: "dine_in", tableNumber: "7", items: [{ itemId: venue.itemId, quantity: 2 }] },
      { customerId },
    );
    if (!placed.ok) throw new Error("order failed");
    await creditOrderIfEligible(tenantId, placed.value.orderId);
  }

  it("401s without a valid token", async () => {
    const res = await GET(request("bogus-token-bogus-token-bogus"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    // The Expo web surface has to be able to READ the refusal.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers the full contract for a guest who has earned", async () => {
    const me = await signIn();
    await earnOne(me.customerId);

    const res = await GET(request(me.token));
    expect(res.status).toBe(200);
    // A balance must never be cached — the URL carries no identity.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const body = (await res.json()) as LoyaltyBody;
    expect(body.ok).toBe(true);
    expect(body.loyalty).toMatchObject({
      enabled: true,
      rewardPoints: 5,
      rewardValueCents: 2000,
      minOrderCents: 2000,
      pointsPerOrder: 5,
    });
    // 5 earned, 5 spent on the voucher the threshold minted.
    expect(body.loyalty?.balance).toBe(0);
    expect(body.loyalty?.vouchers).toHaveLength(1);
    expect(body.loyalty?.vouchers[0]).toMatchObject({ valueCents: 2000, status: "available" });
    expect(new Date(body.loyalty!.vouchers[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Newest first: the voucher debit, then the order credit.
    expect(body.loyalty?.history.map((h) => h.reason)).toEqual(["voucher", "order"]);
    expect(body.loyalty?.history.find((h) => h.reason === "order")?.orderNumber).toBeTypeOf(
      "number",
    );
    expect(body.loyalty?.history.find((h) => h.reason === "voucher")?.orderNumber).toBeNull();
    // Each line quotes the voucher it is about, not the venue's current
    // reward value — see the drift test in loyalty-service.test.ts.
    expect(body.loyalty?.history.find((h) => h.reason === "voucher")?.valueCents).toBe(2000);
    expect(body.loyalty?.history.find((h) => h.reason === "order")?.valueCents).toBeNull();
    expect(body.loyalty?.vouchers[0]?.redeemedOrderNumber).toBeNull();
  });

  it("reports a redeemed voucher with its order and its own value", async () => {
    const me = await signIn();
    await earnOne(me.customerId);
    const listed = (await (await GET(request(me.token))).json()) as LoyaltyBody;
    const voucherId = listed.loyalty!.vouchers[0]!.id;
    await ARM(request(me.token, { armed: true }), {
      params: Promise.resolve({ id: voucherId }),
    });

    // The app's checkout: place the order asking for the armed reward.
    const placed = await placeOrder(
      venue,
      {
        orderType: "dine_in",
        tableNumber: "7",
        items: [{ itemId: venue.itemId, quantity: 2 }],
        redeemVoucher: true,
      },
      { customerId: me.customerId },
    );
    if (!placed.ok) throw new Error("order failed");

    const body = (await (await GET(request(me.token))).json()) as LoyaltyBody;
    expect(body.loyalty?.vouchers[0]).toMatchObject({
      id: voucherId,
      status: "redeemed",
      redeemedOrderNumber: placed.value.orderNumber,
    });
    // "€20 reward used · Order #0031" — everything that sentence needs.
    const redeem = body.loyalty?.history.find((h) => h.reason === "redeem");
    expect(redeem).toMatchObject({
      delta: 0,
      valueCents: 2000,
      orderNumber: placed.value.orderNumber,
    });
  });

  it("arms and disarms a voucher, and 409s a terminal one", async () => {
    const me = await signIn();
    await earnOne(me.customerId);
    const listed = (await (await GET(request(me.token))).json()) as LoyaltyBody;
    const voucherId = listed.loyalty!.vouchers[0]!.id;

    const armed = await ARM(request(me.token, { armed: true }), {
      params: Promise.resolve({ id: voucherId }),
    });
    expect(armed.status).toBe(200);
    expect(((await armed.json()) as LoyaltyBody).voucher).toMatchObject({
      id: voucherId,
      status: "armed",
      valueCents: 2000,
    });

    const off = await ARM(request(me.token, { armed: false }), {
      params: Promise.resolve({ id: voucherId }),
    });
    expect(((await off.json()) as LoyaltyBody).voucher).toMatchObject({ status: "available" });

    // Someone else's (or an invented) voucher is a 404, never a 200.
    const missing = await ARM(request(me.token, { armed: true }), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "not_found" });

    await asTenant(tenantId, (tx) =>
      tx.loyaltyVoucher.updateMany({ where: { id: voucherId }, data: { status: "redeemed" } }),
    );
    const terminal = await ARM(request(me.token, { armed: true }), {
      params: Promise.resolve({ id: voucherId }),
    });
    expect(terminal.status).toBe(409);
    expect(await terminal.json()).toEqual({ ok: false, error: "not_armable" });
  });

  it("401s the arm endpoint without a valid token", async () => {
    const res = await ARM(request("bogus-token-bogus-token-bogus", { armed: true }), {
      params: Promise.resolve({ id: "whatever" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("reports zeros for a signed-in guest who has earned nothing yet", async () => {
    const me = await signIn();
    const body = (await (await GET(request(me.token))).json()) as LoyaltyBody;
    expect(body.loyalty).toMatchObject({ enabled: true, balance: 0, vouchers: [], history: [] });
  });
});
