import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { placeOrder } from "./order-service";
import { createPayPalOrderPayment, finalizePayPalReturn } from "./paypal-service";
import { fakeWebhookSignature, payPalCustomId, type PayPalWebhookHeaders } from "./paypal";
import { encryptSecret } from "./secrets";
import { handlePayPalWebhook, type PayPalWebhookEvent } from "./paypal-webhook-handler";

/**
 * The PayPal webhook on the fake provider. The claim under test: an order
 * the guest approved settles even when the return leg never runs, and
 * nothing that is not a verified PayPal delivery can move an order.
 */
describe("handlePayPalWebhook (server-to-server settlement)", () => {
  const WEBHOOK_ID = "WH-TEST-1234567890";
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

  async function fixture(opts: { webhookId?: string | null } = {}): Promise<{
    tenantId: string;
    venueId: string;
    publishedVersionId: string;
    itemId: string;
  }> {
    const s = await signupUser({
      email: `ppwh-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "PP Webhook Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);

    return asTenant(s.tenantId, async (tx) => {
      const webhookId = opts.webhookId === undefined ? WEBHOOK_ID : opts.webhookId;
      if (webhookId) {
        await tx.tenant.updateMany({ data: { paypalWebhookIdEnc: encryptSecret(webhookId) } });
      }
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "PP Venue",
          slug: `ppwh-${randomUUID().slice(0, 8)}`,
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

  /** Place an order and start PayPal, leaving it `pending` with a paymentRef. */
  async function pendingPayPalOrder(fx: Awaited<ReturnType<typeof fixture>>) {
    const placed = await placeOrder(fx, {
      orderType: "dine_in",
      tableNumber: "7",
      items: [{ itemId: fx.itemId, quantity: 1 }],
    });
    if (!placed.ok) throw new Error("order failed");
    const started = await createPayPalOrderPayment(
      fx.tenantId,
      placed.value.orderId,
      placed.value.receiptToken,
    );
    if (!started.ok) throw new Error("paypal start failed");
    return {
      tenantId: fx.tenantId,
      orderId: placed.value.orderId,
      ref: `pp_fake_${placed.value.orderId}`,
    };
  }

  type Stamped = { tenantId: string; orderId: string; ref: string };

  /** Shaped like PayPal's real CHECKOUT.ORDER.APPROVED payload. */
  function approvedEvent({ tenantId, orderId, ref }: Stamped): PayPalWebhookEvent {
    return {
      id: `WH-${randomUUID()}`,
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource_type: "checkout-order",
      resource: {
        id: ref,
        status: "APPROVED",
        purchase_units: [{ reference_id: orderId, custom_id: payPalCustomId(tenantId, orderId) }],
      },
    };
  }

  /** Shaped like PayPal's real PAYMENT.CAPTURE.COMPLETED payload. */
  function captureCompletedEvent({ tenantId, orderId, ref }: Stamped): PayPalWebhookEvent {
    return {
      id: `WH-${randomUUID()}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_type: "capture",
      resource: {
        id: `CAP-${randomUUID().slice(0, 8)}`,
        status: "COMPLETED",
        custom_id: payPalCustomId(tenantId, orderId),
        supplementary_data: { related_ids: { order_id: ref } },
      },
    };
  }

  /** Sign the way the fake verifies; `webhookId` lets a test forge a bad one. */
  function deliver(event: PayPalWebhookEvent, webhookId = WEBHOOK_ID) {
    const rawBody = JSON.stringify(event);
    const headers: PayPalWebhookHeaders = {
      transmissionId: randomUUID(),
      transmissionTime: new Date().toISOString(),
      transmissionSig: fakeWebhookSignature(webhookId, rawBody),
      certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test",
      authAlgo: "SHA256withRSA",
    };
    return handlePayPalWebhook({ rawBody, headers });
  }

  async function paymentStatus(tenantId: string, orderId: string): Promise<string> {
    const o = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    return o.paymentStatus;
  }

  it("CHECKOUT.ORDER.APPROVED settles an order the guest never returned for; replay is a no-op", async () => {
    const fx = await fixture();
    const stamped = await pendingPayPalOrder(fx);
    const { orderId } = stamped;
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("pending");

    const event = approvedEvent(stamped);
    const first = await deliver(event);
    expect(first).toEqual({ status: 200, kind: "processed" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("paid");

    const second = await deliver(event);
    expect(second).toEqual({ status: 200, kind: "replayed" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("paid");
  });

  it("PAYMENT.CAPTURE.COMPLETED after the return leg already settled is harmless", async () => {
    const fx = await fixture();
    const stamped = await pendingPayPalOrder(fx);
    const { orderId } = stamped;
    expect((await finalizePayPalReturn(fx.tenantId, orderId)).paid).toBe(true);

    const outcome = await deliver(captureCompletedEvent(stamped));
    expect(outcome).toEqual({ status: 200, kind: "processed" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("paid");
  });

  it("a forged signature is rejected and the order stays pending", async () => {
    const fx = await fixture();
    const stamped = await pendingPayPalOrder(fx);
    const { orderId } = stamped;

    const outcome = await deliver(approvedEvent(stamped), "WH-SOMEONE-ELSES-APP");
    expect(outcome).toEqual({ status: 400, kind: "invalid_signature" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("pending");

    // A rejected delivery must not have burned its event id: the genuine
    // retry with the same id still processes.
    const genuine = approvedEvent(stamped);
    await deliver(genuine, "WH-SOMEONE-ELSES-APP");
    expect(await deliver(genuine)).toEqual({ status: 200, kind: "processed" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("paid");
  });

  it("an event about a PayPal order we never created is rejected as invalid", async () => {
    const fx = await fixture();
    const stamped = await pendingPayPalOrder(fx);
    const { orderId } = stamped;
    const outcome = await deliver(approvedEvent({ ...stamped, ref: `pp_fake_${randomUUID()}` }));
    expect(outcome).toEqual({ status: 400, kind: "invalid" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("pending");
  });

  it("a stamp naming a different tenant cannot reach the order", async () => {
    const fx = await fixture();
    const stamped = await pendingPayPalOrder(fx);
    const other = await fixture();
    const outcome = await deliver(approvedEvent({ ...stamped, tenantId: other.tenantId }));
    expect(outcome).toEqual({ status: 400, kind: "invalid" });
    expect(await paymentStatus(fx.tenantId, stamped.orderId)).toBe("pending");
  });

  it("without a webhook id on file (and none in env) deliveries are not_configured", async () => {
    const fx = await fixture({ webhookId: null });
    const stamped = await pendingPayPalOrder(fx);
    const { orderId } = stamped;
    const outcome = await deliver(approvedEvent(stamped));
    expect(outcome).toEqual({ status: 400, kind: "not_configured" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("pending");
  });

  it("a denied capture marks the order failed (guest: retry / pay cash / cancel)", async () => {
    const fx = await fixture();
    const stamped = await pendingPayPalOrder(fx);
    const { orderId, ref } = stamped;
    const denied: PayPalWebhookEvent = {
      id: `WH-${randomUUID()}`,
      event_type: "PAYMENT.CAPTURE.DENIED",
      resource: {
        id: "CAP-x",
        custom_id: payPalCustomId(fx.tenantId, orderId),
        supplementary_data: { related_ids: { order_id: ref } },
      },
    };
    expect(await deliver(denied)).toEqual({ status: 200, kind: "processed" });
    expect(await paymentStatus(fx.tenantId, orderId)).toBe("failed");
  });

  it("malformed bodies are 400 invalid", async () => {
    const headers: PayPalWebhookHeaders = {
      transmissionId: "x",
      transmissionTime: "x",
      transmissionSig: "00",
      certUrl: "x",
      authAlgo: "x",
    };
    expect(await handlePayPalWebhook({ rawBody: "not json", headers })).toEqual({
      status: 400,
      kind: "invalid",
    });
    expect(await handlePayPalWebhook({ rawBody: JSON.stringify({ foo: 1 }), headers })).toEqual({
      status: 400,
      kind: "invalid",
    });
  });
});
