import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { placeOrder } from "./order-service";
import { createPayPalOrderPayment, finalizePayPalReturn } from "./paypal-service";
import { getPayPalProvider, paypalAvailable, tenantPayPalKeysApply } from "./paypal";
import { signReceiptToken } from "./receipt-token";

/**
 * PayPal single-merchant flow on the fake provider — the same posture as
 * the Stripe suite: vitest.setup strips PAYPAL_* so this is hermetic.
 */
describe("paypal payments (fake provider, full flow)", () => {
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

  async function fixture(): Promise<{
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    const s = await signupUser({
      email: `pp-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "PP Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);

    return asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "PP Venue",
          slug: `pp-test-${randomUUID().slice(0, 8)}`,
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
        data: { tenantId: s.tenantId, menuVersionId: version.id, name: "Mains", orderIndex: 0 },
        select: { id: true },
      });
      const item = await tx.item.create({
        data: {
          tenantId: s.tenantId,
          categoryId: cat.id,
          name: "Karahi",
          priceCents: 1290,
          orderIndex: 0,
        },
        select: { id: true },
      });
      return {
        tenantId: s.tenantId,
        venueId: venue.id,
        publishedVersionId: version.id,
        itemId: item.id,
      };
    });
  }

  it("server LIVE keys outrank a restaurant's sandbox keys; its own live keys still win", () => {
    const own = { clientId: "id", secret: "sec", enabled: true };
    expect(tenantPayPalKeysApply({ ...own, env: "sandbox" }, "live")).toBe(false);
    expect(tenantPayPalKeysApply({ ...own, env: "live" }, "live")).toBe(true);
    expect(tenantPayPalKeysApply({ ...own, env: "sandbox" }, "sandbox")).toBe(true);
    expect(tenantPayPalKeysApply({ ...own, env: "sandbox" }, "fake")).toBe(true);
    expect(tenantPayPalKeysApply({ ...own, env: "live", enabled: false }, "live")).toBe(false);
    expect(tenantPayPalKeysApply({ ...own, env: "live", secret: null }, "fake")).toBe(false);
  });

  it("runs on the fake provider in tests, and is offered to guests", () => {
    expect(getPayPalProvider().mode).toBe("fake");
    expect(paypalAvailable()).toBe(true);
  });

  it("start → pending with provider stamped; return leg captures and settles; idempotent", async () => {
    const fx = await fixture();
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      tableNumber: "5",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    const { orderId, receiptToken } = placed.value;

    const started = await createPayPalOrderPayment(fx.tenantId, orderId, receiptToken);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // The fake bounces straight back to our return leg.
    expect(started.url).toContain("/api/paypal/return");

    const pending = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId } }),
    );
    expect(pending.paymentStatus).toBe("pending");
    expect(pending.paymentProvider).toBe("paypal");
    expect(pending.paymentRef).toBe(`pp_fake_${orderId}`);

    const first = await finalizePayPalReturn(fx.tenantId, orderId);
    expect(first.paid).toBe(true);
    const paid = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId } }),
    );
    expect(paid.paymentStatus).toBe("paid");

    // A refreshed return URL must not double-settle or error.
    const second = await finalizePayPalReturn(fx.tenantId, orderId);
    expect(second.paid).toBe(true);
  });

  it("refuses a token for a different order, and a paid order", async () => {
    const fx = await fixture();
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");

    const wrongToken = signReceiptToken("someone-elses-order", fx.tenantId);
    const refused = await createPayPalOrderPayment(fx.tenantId, placed.value.orderId, wrongToken);
    expect(refused).toEqual({ ok: false, error: "invalid_token" });

    const started = await createPayPalOrderPayment(
      fx.tenantId,
      placed.value.orderId,
      placed.value.receiptToken,
    );
    expect(started.ok).toBe(true);
    await finalizePayPalReturn(fx.tenantId, placed.value.orderId);
    const again = await createPayPalOrderPayment(
      fx.tenantId,
      placed.value.orderId,
      placed.value.receiptToken,
    );
    expect(again).toEqual({ ok: false, error: "already_paid" });
  });

  it("finalize on an order that never started PayPal is a safe no-op", async () => {
    const fx = await fixture();
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    const result = await finalizePayPalReturn(fx.tenantId, placed.value.orderId);
    expect(result.paid).toBe(false);
    const order = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: placed.value.orderId } }),
    );
    expect(order.paymentStatus).toBe("none");
  });
});
