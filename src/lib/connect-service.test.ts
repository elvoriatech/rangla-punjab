import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { listRecentOrders, placeOrder } from "./order-service";
import {
  createOrderPayment,
  getConnectStatus,
  markOrderPaid,
  refreshConnectStatus,
  startConnectOnboarding,
} from "./connect-service";
import { getStripeProvider } from "./stripe";
import { computePlatformFeeCents, DEFAULT_OPERATOR_SETTINGS } from "./operator-settings";

describe("connect payments (fake provider, full flow)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  async function fixture(plan: "scale" | "growth"): Promise<{
    userId: string;
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    const s = await signupUser({
      email: `pay-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Pay Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);

    return asTenant(s.tenantId, async (tx) => {
      await tx.tenant.updateMany({ data: { plan } });
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Pay Test Venue",
          slug: `pay-test-${randomUUID().slice(0, 8)}`,
          currency: "EUR",
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      const version = await tx.menuVersion.create({
        data: {
          tenantId: s.tenantId,
          menuId: menu.id,
          status: "published",
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.menu.update({ where: { id: menu.id }, data: { publishedVersion: version.id } });
      const cat = await tx.category.create({
        data: {
          tenantId: s.tenantId,
          menuVersionId: version.id,
          name: "Mains",
          orderIndex: 0,
        },
        select: { id: true },
      });
      const item = await tx.item.create({
        data: {
          tenantId: s.tenantId,
          categoryId: cat.id,
          name: "Biryani",
          priceCents: 1490,
          orderIndex: 0,
        },
        select: { id: true },
      });
      return {
        userId: s.userId,
        tenantId: s.tenantId,
        venueId: venue.id,
        publishedVersionId: version.id,
        itemId: item.id,
      };
    });
  }

  it("onboard → order → checkout → settle marks the order paid with the fee", async () => {
    const fx = await fixture("scale");

    // 1. Owner onboards; the fake provider enables charges instantly.
    const onboard = await startConnectOnboarding(fx.userId, "owner@ex.com", "/x/billing");
    expect(onboard).toEqual({ ok: true, url: expect.stringContaining("connect=done") });
    await refreshConnectStatus(fx.userId);
    const status = await getConnectStatus(fx.userId);
    expect(status).toMatchObject({ entitled: true, chargesEnabled: true });

    // 2. Guest orders (pay-at-restaurant by default).
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      tableNumber: "3",
      items: [{ itemId: fx.itemId, quantity: 2 }],
    });
    if (!placed.ok) throw new Error("order failed");
    expect(placed.value.totalCents).toBe(2980);

    // 3. Guest starts the online payment with their receipt token.
    const pay = await createOrderPayment(
      fx.tenantId,
      placed.value.orderId,
      placed.value.receiptToken,
    );
    if (!pay.ok) throw new Error(`payment refused: ${pay.error}`);
    expect(pay.url).toContain(`/pay/${placed.value.orderId}`);

    const pending = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirstOrThrow({
        where: { id: placed.value.orderId },
        select: { paymentStatus: true, paymentRef: true, applicationFeeCents: true },
      }),
    );
    expect(pending.paymentStatus).toBe("pending");
    // Seeded operator defaults (percentage / 500bp / €20 min): 5% of €29.80.
    expect(pending.applicationFeeCents).toBe(
      computePlatformFeeCents(2980, DEFAULT_OPERATOR_SETTINGS),
    ); // 149 cents

    // 4. The provider settles (webhook analogue) → paid, idempotently.
    const provider = (await getStripeProvider()) as unknown as {
      settleOrderCheckout(ref: string): { orderId: string } | null;
    };
    const settled = provider.settleOrderCheckout(pending.paymentRef!);
    expect(settled?.orderId).toBe(placed.value.orderId);
    expect(await markOrderPaid(fx.tenantId, placed.value.orderId)).toBe(true);
    expect(await markOrderPaid(fx.tenantId, placed.value.orderId)).toBe(false); // idempotent

    const paid = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirstOrThrow({
        where: { id: placed.value.orderId },
        select: { paymentStatus: true },
      }),
    );
    expect(paid.paymentStatus).toBe("paid");

    // 5. P2-5: the kitchen screen sees the settled order as paid. (The
    // real Stripe webhook dispatcher → markOrderPaid path is covered in
    // stripe/webhook-handler.test.ts; this closes the loop to the KDS.)
    const kitchen = await listRecentOrders(fx.userId);
    const seen = kitchen.find((o) => o.id === placed.value.orderId);
    expect(seen?.paymentStatus).toBe("paid");
  });

  it("P2-3: a tenant with no Scale subscription can still onboard and reach checkout", async () => {
    const fx = await fixture("growth"); // no payments entitlement under the old SaaS gate

    // Onboarding is no longer subscription-gated — it succeeds.
    const onboard = await startConnectOnboarding(fx.userId, "owner@ex.com", "/x/billing");
    expect(onboard).toEqual({ ok: true, url: expect.stringContaining("connect=done") });
    await refreshConnectStatus(fx.userId);

    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    const pay = await createOrderPayment(
      fx.tenantId,
      placed.value.orderId,
      placed.value.receiptToken,
    );
    // Reaches checkout purely on charges-enabled — no entitlement required.
    expect(pay.ok).toBe(true);
  });

  it("charges directly on the deployment's keys when no own keys are saved — no Connect needed", async () => {
    const fx = await fixture("growth"); // never onboarded → no connected account at all
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    const pay = await createOrderPayment(
      fx.tenantId,
      placed.value.orderId,
      placed.value.receiptToken,
    );
    // Single-restaurant build: the shared (env / fake) provider IS the
    // restaurant's account, so checkout is a direct charge with 0 fee.
    expect(pay.ok).toBe(true);
    const order = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: placed.value.orderId } }),
    );
    expect(order.paymentStatus).toBe("pending");
    expect(order.paymentProvider).toBe("stripe");
    expect(order.paymentRef?.startsWith("pi_own_")).toBe(true);
    expect(order.applicationFeeCents).toBe(0);
  });

  it("rejects forged or mismatched receipt tokens", async () => {
    const fx = await fixture("scale");
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    expect(await createOrderPayment(fx.tenantId, placed.value.orderId, "forged.token")).toEqual({
      ok: false,
      error: "invalid_token",
    });
    expect(
      await createOrderPayment(fx.tenantId, "other-order-id", placed.value.receiptToken),
    ).toEqual({ ok: false, error: "invalid_token" });
  });
});
