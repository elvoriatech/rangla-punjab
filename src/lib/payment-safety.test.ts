import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { placeOrder } from "./order-service";
import {
  LATE_PAYMENT_MS,
  createOrderPayment,
  markOrderPaid,
  settleStripeOrderPayment,
} from "./connect-service";
import { createPayPalOrderPayment, finalizePayPalReturn } from "./paypal-service";
import { deleteOrder } from "./order-delete-service";
import { getStripeProvider } from "./stripe";
import { handleStripeEvent } from "./stripe/webhook-handler";

/**
 * Order O-6 (2026-10-19): the guest opened the card page, switched to
 * PayPal, then paid the OLD card page anyway; the webhook failed, and
 * Stripe's retry plus a manual resend put the order on the board twice, a
 * day late. Each scenario below is one way that flow could mislead.
 */
describe("payment safety (fake providers)", () => {
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
    userId: string;
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    const s = await signupUser({
      email: `safe-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Safety Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);
    return asTenant(s.tenantId, async (tx) => {
      // Card and PayPal both switched on; no own keys → the fake providers.
      await tx.tenant.updateMany({ data: { stripeOwnEnabled: true, paypalOwnEnabled: true } });
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Safety Venue",
          slug: `safe-${randomUUID().slice(0, 8)}`,
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
          name: "Nawabi Chicken",
          priceCents: 1690,
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

  type Fx = Awaited<ReturnType<typeof fixture>>;

  async function order(fx: Fx): Promise<{ orderId: string; token: string }> {
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      tableNumber: "4",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    return { orderId: placed.value.orderId, token: placed.value.receiptToken };
  }

  async function startCard(fx: Fx, orderId: string, token: string): Promise<string> {
    const pay = await createOrderPayment(fx.tenantId, orderId, token);
    if (!pay.ok) throw new Error(`card start refused: ${pay.error}`);
    const row = await read(fx, orderId);
    return row!.paymentRef!;
  }

  function read(fx: Fx, orderId: string) {
    return asTenant(fx.tenantId, (tx) => tx.order.findFirst({ where: { id: orderId } }));
  }

  async function fakeStripe() {
    return (await getStripeProvider()) as unknown as {
      retrievePaymentIntent(ref: string): Promise<{ status: string } | null>;
      settleOrderCheckout(ref: string): { orderId: string } | null;
    };
  }

  /** Order-log rows are written fire-and-forget: wait for one to land. */
  async function eventKinds(fx: Fx, orderId: string, kind: string): Promise<void> {
    await vi.waitFor(
      async () => {
        const rows = await asTenant(fx.tenantId, (tx) =>
          tx.orderEvent.findMany({ where: { orderId, kind }, select: { id: true } }),
        );
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 50 },
    );
  }

  async function backdate(fx: Fx, orderId: string): Promise<void> {
    await asTenant(fx.tenantId, (tx) =>
      tx.order.update({
        where: { id: orderId },
        data: { createdAt: new Date(Date.now() - LATE_PAYMENT_MS - 60_000) },
      }),
    );
  }

  it("switching from the card page to PayPal closes the card page", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);

    const pp = await createPayPalOrderPayment(fx.tenantId, orderId, token);
    expect(pp.ok).toBe(true);
    // The old card page can no longer take money.
    expect(await (await fakeStripe()).retrievePaymentIntent(cardRef)).toBeNull();
    expect((await read(fx, orderId))?.paymentProvider).toBe("paypal");
  });

  it("a card retry closes the previous card page", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const first = await startCard(fx, orderId, token);
    const second = await startCard(fx, orderId, token);
    expect(second).not.toBe(first);
    expect(await (await fakeStripe()).retrievePaymentIntent(first)).toBeNull();
  });

  it("if the old card page was already paid, switching settles it instead of starting PayPal", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    (await fakeStripe()).settleOrderCheckout(cardRef);

    const pp = await createPayPalOrderPayment(fx.tenantId, orderId, token);
    expect(pp).toEqual({ ok: false, error: "already_paid" });
    const row = await read(fx, orderId);
    expect(row?.paymentStatus).toBe("paid");
    expect(row?.paymentProvider).toBe("stripe");
    expect(row?.paymentRef).toBe(cardRef);
  });

  it("money on an earlier card page of an unpaid order settles it as card — and PayPal is never captured on top", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);

    const outcome = await settleStripeOrderPayment(fx.tenantId, orderId, "cs_earlier_page");
    expect(outcome).toBe("superseded_settled");
    const row = await read(fx, orderId);
    expect(row?.paymentStatus).toBe("paid");
    expect(row?.paymentProvider).toBe("stripe");
    expect(row?.paymentRef).toBe("cs_earlier_page");
    await eventKinds(fx, orderId, "payment.superseded_paid");

    // The PayPal approval coming back now must not charge the guest again.
    expect((await finalizePayPalReturn(fx.tenantId, orderId)).paid).toBe(false);
  });

  it("the same payment delivered again (retry or manual resend) changes nothing", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    expect(await settleStripeOrderPayment(fx.tenantId, orderId, cardRef)).toBe("settled");
    expect(await settleStripeOrderPayment(fx.tenantId, orderId, cardRef)).toBe("already_paid");
  });

  it("a second, different payment on a paid order is flagged for refund, not applied", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    await settleStripeOrderPayment(fx.tenantId, orderId, cardRef);

    expect(await settleStripeOrderPayment(fx.tenantId, orderId, "cs_other")).toBe("needs_refund");
    expect((await read(fx, orderId))?.paymentRef).toBe(cardRef);
    await eventKinds(fx, orderId, "payment.needs_refund");
  });

  it("a deleted order never comes back — money for it is flagged in its kept history", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    const del = await deleteOrder(fx.userId, orderId, "Testing / fake order");
    expect(del.ok).toBe(true);
    // Deleting closed the card page …
    expect(await (await fakeStripe()).retrievePaymentIntent(cardRef)).toBeNull();

    // … and even a delivered payment event (Stripe retry, manual resend)
    // finds nothing to settle: the order stays gone.
    const event = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { id: cardRef, metadata: { orderId, tenantId: fx.tenantId } } },
    };
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });
    expect(await read(fx, orderId)).toBeNull();
    await eventKinds(fx, orderId, "payment.needs_refund");
  });

  it("deleting removes the order's bell notifications", async () => {
    const fx = await fixture();
    const { orderId } = await order(fx);
    await asTenant(fx.tenantId, (tx) =>
      tx.staffNotification.create({
        data: {
          tenantId: fx.tenantId,
          kind: "order",
          need: "orders",
          title: "New order",
          body: "x",
          data: { kind: "order", orderId },
        },
      }),
    );
    await deleteOrder(fx.userId, orderId, "Testing / fake order");
    const left = await asTenant(fx.tenantId, (tx) =>
      tx.staffNotification.count({ where: { data: { path: ["orderId"], equals: orderId } } }),
    );
    expect(left).toBe(0);
  });

  it("a payment confirmed hours after the order leaves it untouched and off the board", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await startCard(fx, orderId, token);
    await backdate(fx, orderId);
    expect(await markOrderPaid(fx.tenantId, orderId)).toBe(false);
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");
    await eventKinds(fx, orderId, "payment.late");
  });

  it("O-6 replay: a Stripe retry days later, then a manual resend, never touch the order", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    await backdate(fx, orderId);
    const before = await read(fx, orderId);

    const event = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: cardRef,
          payment_status: "paid",
          metadata: { orderId, tenantId: fx.tenantId },
        },
      },
    };
    expect((await handleStripeEvent(event)).status).toBe(200); // Stripe stops retrying
    expect((await handleStripeEvent(event)).kind).toBe("replayed"); // the manual resend
    const after = await read(fx, orderId);
    expect(after?.paymentStatus).toBe(before?.paymentStatus);
    expect(after?.paymentProvider).toBe(before?.paymentProvider);
    expect(after?.paymentRef).toBe(before?.paymentRef);
    await eventKinds(fx, orderId, "payment.late");
  });

  it("a checkout finished UNPAID (delayed method) does not settle; its later failure fails the order", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    const completed = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: cardRef,
          payment_status: "unpaid",
          metadata: { orderId, tenantId: fx.tenantId },
        },
      },
    };
    await handleStripeEvent(completed);
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");

    const failed = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.async_payment_failed",
      data: { object: { id: cardRef, metadata: { orderId, tenantId: fx.tenantId } } },
    };
    await handleStripeEvent(failed);
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
  });

  it("a delayed method that later succeeds settles the order", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    const succeeded = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          id: cardRef,
          payment_status: "paid",
          metadata: { orderId, tenantId: fx.tenantId },
        },
      },
    };
    await handleStripeEvent(succeeded);
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("a PayPal approval coming back hours later is not captured", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    await backdate(fx, orderId);

    expect((await finalizePayPalReturn(fx.tenantId, orderId)).paid).toBe(false);
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
    await eventKinds(fx, orderId, "payment.too_late");
  });

  it("a decline on an older card attempt does not fail the guest's current payment", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    const event = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_older_attempt", metadata: { orderId, tenantId: fx.tenantId } } },
    };
    await handleStripeEvent(event);
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");
  });
});
