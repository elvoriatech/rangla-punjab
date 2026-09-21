import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { placeOrder } from "./order-service";
import { createPayPalOrderPayment, finalizePayPalReturn } from "./paypal-service";
import { getPayPalProvider, paypalAvailable } from "./paypal";
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

  it("lets the guest cancel an unpaid online order — and PayPal then never captures it", async () => {
    const { cancelUnpaidOrderByGuest } = await import("./connect-service");
    const fx = await fixture();
    const place = async () => {
      const placed = await placeOrder(fx, {
        orderType: "dine_in",
        tableNumber: "5",
        items: [{ itemId: fx.itemId, quantity: 1 }],
      });
      if (!placed.ok) throw new Error("order failed");
      return placed.value;
    };
    const statusOf = async (id: string) =>
      asTenant(fx.tenantId, (tx) =>
        tx.order.findFirstOrThrow({
          where: { id },
          select: { status: true, paymentStatus: true },
        }),
      );

    // PayPal started, guest gives up → cancelled; the late return leg
    // must not capture money for it.
    const a = await place();
    expect((await createPayPalOrderPayment(fx.tenantId, a.orderId, a.receiptToken)).ok).toBe(true);
    expect(
      await cancelUnpaidOrderByGuest(fx.tenantId, a.orderId, signReceiptToken("x", fx.tenantId)),
    ).toEqual({ ok: false, error: "invalid_token" });
    expect(await cancelUnpaidOrderByGuest(fx.tenantId, a.orderId, a.receiptToken)).toEqual({
      ok: true,
    });
    expect(await finalizePayPalReturn(fx.tenantId, a.orderId)).toEqual({ paid: false });
    expect(await statusOf(a.orderId)).toEqual({ status: "cancelled", paymentStatus: "pending" });

    // No online payment chosen (cash at the till) → not the guest's to cancel.
    const b = await place();
    expect(await cancelUnpaidOrderByGuest(fx.tenantId, b.orderId, b.receiptToken)).toEqual({
      ok: false,
      error: "not_cancellable",
    });

    // The kitchen already started it → too late.
    const c = await place();
    await createPayPalOrderPayment(fx.tenantId, c.orderId, c.receiptToken);
    await asTenant(fx.tenantId, (tx) =>
      tx.order.update({ where: { id: c.orderId }, data: { status: "preparing" } }),
    );
    expect(await cancelUnpaidOrderByGuest(fx.tenantId, c.orderId, c.receiptToken)).toEqual({
      ok: false,
      error: "not_cancellable",
    });

    // Paid → never cancelled by the guest.
    const d = await place();
    await createPayPalOrderPayment(fx.tenantId, d.orderId, d.receiptToken);
    await finalizePayPalReturn(fx.tenantId, d.orderId);
    expect(await cancelUnpaidOrderByGuest(fx.tenantId, d.orderId, d.receiptToken)).toEqual({
      ok: false,
      error: "already_paid",
    });
  });

  it("online orders reach the kitchen only once paid; cash goes straight there", async () => {
    const { listRecentOrders } = await import("./order-service");
    const fx = await fixture();
    const userId = createdUserIds[createdUserIds.length - 1]!;
    const place = async (intendedPayment: "cash" | "card" | "paypal") => {
      const placed = await placeOrder(fx, {
        orderType: "dine_in",
        items: [{ itemId: fx.itemId, quantity: 1 }],
        intendedPayment,
      });
      if (!placed.ok) throw new Error("order failed");
      return placed.value;
    };
    const kitchenIds = async () =>
      (await listRecentOrders(userId, 50, { scope: "open" })).map((o) => o.id);
    const awaitingIds = async () =>
      (await listRecentOrders(userId, 50, { scope: "awaiting_payment" })).map((o) => o.id);

    const cash = await place("cash");
    const card = await place("card");
    const pp = await place("paypal");
    expect(await kitchenIds()).toContain(cash.orderId);
    expect(await kitchenIds()).not.toContain(card.orderId);
    expect(await kitchenIds()).not.toContain(pp.orderId);
    expect(await awaitingIds()).toEqual(expect.arrayContaining([card.orderId, pp.orderId]));

    // PayPal paid → on the board, off the awaiting list.
    await createPayPalOrderPayment(fx.tenantId, pp.orderId, pp.receiptToken);
    await finalizePayPalReturn(fx.tenantId, pp.orderId);
    expect(await kitchenIds()).toContain(pp.orderId);
    expect(await awaitingIds()).not.toContain(pp.orderId);
  });

  it("'pay cash instead' sends an unpaid online order to the kitchen — only where cash is accepted", async () => {
    const { switchUnpaidOrderToCash } = await import("./connect-service");
    const { listRecentOrders } = await import("./order-service");
    const fx = await fixture();
    const userId = createdUserIds[createdUserIds.length - 1]!;
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      items: [{ itemId: fx.itemId, quantity: 1 }],
      intendedPayment: "paypal",
    });
    if (!placed.ok) throw new Error("order failed");
    const { orderId, receiptToken } = placed.value;
    await createPayPalOrderPayment(fx.tenantId, orderId, receiptToken);

    // A venue that does not list cash never offers the switch.
    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({ data: { ordering: { acceptedPayments: ["paypal"] } } }),
    );
    expect(await switchUnpaidOrderToCash(fx.tenantId, orderId, receiptToken)).toEqual({
      ok: false,
      error: "cash_not_accepted",
    });

    await asTenant(fx.tenantId, (tx) =>
      tx.venue.updateMany({ data: { ordering: { acceptedPayments: ["cash", "paypal"] } } }),
    );
    expect(await switchUnpaidOrderToCash(fx.tenantId, orderId, receiptToken)).toEqual({
      ok: true,
    });
    const row = await asTenant(fx.tenantId, (tx) =>
      tx.order.findFirstOrThrow({
        where: { id: orderId },
        select: { status: true, paymentStatus: true, paymentProvider: true, paymentRef: true },
      }),
    );
    expect(row).toEqual({
      status: "placed",
      paymentStatus: "none",
      paymentProvider: null,
      paymentRef: null,
    });
    // Now it is a cash order: on the kitchen board, and PayPal's late
    // return leg does not capture anything for it.
    expect((await listRecentOrders(userId, 50, { scope: "open" })).map((o) => o.id)).toContain(
      orderId,
    );
    expect(await finalizePayPalReturn(fx.tenantId, orderId)).toEqual({ paid: false });
    // And a second switch is refused — it is no longer an online order.
    expect(await switchUnpaidOrderToCash(fx.tenantId, orderId, receiptToken)).toEqual({
      ok: false,
      error: "not_cancellable",
    });
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
