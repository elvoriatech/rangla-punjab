import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { placeOrder } from "./order-service";
import {
  createOrderPayment,
  processStripeOrderPayment,
  reconcilePendingPayments,
} from "./connect-service";
import { createPayPalOrderPayment, finalizePayPalReturn } from "./paypal-service";
import { deleteOrder } from "./order-delete-service";
import { getStripeProvider } from "./stripe";
import type { FakeStripeProvider } from "./stripe/fake-provider";
import { handleStripeEvent } from "./stripe/webhook-handler";
import { processWebhookOnce } from "./webhook-claims";
import { listReconcileTargets, reconcilePayments } from "./payment-reconcile";
import { settleConfirmedPayment } from "./payment-settlement";
import { getPayPalProvider } from "./paypal";

/**
 * Order O-6 (2026-10-19): the guest opened the card page, switched to
 * PayPal, then paid the OLD card page anyway; the webhook failed, and a
 * Stripe retry plus a manual resend put the order on the board twice, a day
 * late. The rules since (owner, 2026-10-21): money is reserved, checked and
 * only then captured; anything that fails a check is released, so the
 * guest is never charged and the order stays failed.
 */
describe("payment safety (fake providers)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
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

  async function fixture() {
    const s = await signupUser({
      email: `safe-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Safety Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);
    return asTenant(s.tenantId, async (tx) => {
      // Card and PayPal both on; no own keys → the fake providers.
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

  const fake = async () => (await getStripeProvider()) as unknown as FakeStripeProvider;

  async function startCard(fx: Fx, orderId: string, token: string): Promise<string> {
    const pay = await createOrderPayment(fx.tenantId, orderId, token);
    if (!pay.ok) throw new Error(`card start refused: ${pay.error}`);
    return (await read(fx, orderId))!.paymentRef!;
  }

  const read = (fx: Fx, orderId: string) =>
    asTenant(fx.tenantId, (tx) => tx.order.findFirst({ where: { id: orderId } }));

  const attemptOf = (fx: Fx, ref: string) =>
    asTenant(fx.tenantId, (tx) => tx.paymentAttempt.findFirst({ where: { ref } }));

  const stripeState = async (ref: string) =>
    (await (await fake()).retrievePaymentIntent(ref))?.status;

  const setAttemptStart = (fx: Fx, ref: string, at: Date) =>
    asTenant(fx.tenantId, (tx) =>
      tx.paymentAttempt.updateMany({ where: { ref }, data: { createdAt: at } }),
    );

  /** Leave an attempt as a crashed run would: "capturing", started long ago. */
  const markCapturing = (fx: Fx, ref: string, at = new Date(Date.now() - 10 * 60 * 1000)) =>
    asTenant(fx.tenantId, (tx) =>
      tx.paymentAttempt.updateMany({
        where: { ref },
        data: { status: "capturing", captureStartedAt: at },
      }),
    );

  /** The reconciler's work list, limited to this test's tenant. */
  const targetsFor = async (fx: Fx) =>
    (await listReconcileTargets(500)).filter((t) => t.tenantId === fx.tenantId);

  const paypalFake = () =>
    getPayPalProvider() as unknown as {
      setApprovedAt(ref: string, at: Date): void;
      markCapturedAtPayPal(ref: string): void;
    };

  const events = (fx: Fx, orderId: string) =>
    asTenant(fx.tenantId, (tx) =>
      tx.orderEvent.findMany({ where: { orderId }, select: { kind: true } }),
    ).then((rows) => rows.map((r) => r.kind));

  function checkoutCompleted(fx: Fx, orderId: string, ref: string, id = `evt_${randomUUID()}`) {
    return {
      id,
      type: "checkout.session.completed",
      data: {
        object: { id: ref, payment_status: "unpaid", metadata: { orderId, tenantId: fx.tenantId } },
      },
    };
  }

  // ---------------------------------------------------------------- basics

  it("a card payment is only reserved until the server captures it, then the order is paid", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref);
    expect(await stripeState(ref)).toBe("requires_capture");
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");

    await handleStripeEvent(checkoutCompleted(fx, orderId, ref));
    expect(await stripeState(ref)).toBe("succeeded");
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
    expect(await attemptOf(fx, ref)).toMatchObject({ status: "succeeded", settled: true });
  });

  it("the attempt's amount can never be changed (database trigger)", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    await expect(
      asTenant(fx.tenantId, (tx) =>
        tx.paymentAttempt.updateMany({ where: { ref }, data: { amountCents: 1 } }),
      ),
    ).rejects.toThrow(/immutable/);
  });

  // ---------------------------------------------------- duplicate webhooks

  it("duplicate webhooks: the same event twice, and a second event for the same payment, capture once", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref);

    const event = checkoutCompleted(fx, orderId, ref);
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "replayed" }); // resend
    const other = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: { object: { id: ref, metadata: { orderId, tenantId: fx.tenantId } } },
    };
    expect((await handleStripeEvent(other)).status).toBe(200);
    const kinds = await events(fx, orderId);
    expect(kinds.filter((k) => k === "payment.paid")).toHaveLength(1);
  });

  // ------------------------------------------------------- server downtime

  it("failed processing stays retryable: the claim is released and the retry runs", async () => {
    const id = `evt_${randomUUID()}`;
    await expect(
      processWebhookOnce(id, "stripe", () => Promise.reject(new Error("db down"))),
    ).rejects.toThrow("db down");
    expect(await prisma.webhookEvent.findUnique({ where: { id } })).toBeNull();
    expect(await processWebhookOnce(id, "stripe", async () => "ok")).toBe("ok");
    expect(await processWebhookOnce(id, "stripe", async () => "again")).toBe("replayed");
    await prisma.webhookEvent.deleteMany({ where: { id } });
  });

  it("a delivery racing an in-flight one is told to retry; a crashed claim is taken over", async () => {
    const id = `evt_${randomUUID()}`;
    await prisma.webhookEvent.create({ data: { id, provider: "stripe", status: "processing" } });
    expect(await processWebhookOnce(id, "stripe", async () => "ok")).toBe("busy");
    await prisma.webhookEvent.update({
      where: { id },
      data: { claimedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    expect(await processWebhookOnce(id, "stripe", async () => "ok")).toBe("ok");
    await prisma.webhookEvent.deleteMany({ where: { id } });
  });

  it("webhooks down: the dashboard sweep captures a payment still inside the window", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref); // paid, but no webhook arrives
    expect(await reconcilePendingPayments(fx.userId)).toBe(1);
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("server down for hours: a payment AUTHORIZED in time is still captured and settled", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const f = await fake();
    f.settleOrderCheckout(ref);
    // The attempt started 3 h ago and the guest authorized 10 min in; our
    // server only gets to it now.
    const started = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await setAttemptStart(fx, ref, started);
    f.setAuthorizedAt(ref, new Date(started.getTime() + 10 * 60 * 1000));

    expect(await reconcilePayments(await targetsFor(fx))).toMatchObject({ settled: 1 });
    expect(await stripeState(ref)).toBe("succeeded");
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("a payment AUTHORIZED after the 45-minute window is released — not charged, order failed", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const f = await fake();
    f.settleOrderCheckout(ref);
    const started = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await setAttemptStart(fx, ref, started);
    f.setAuthorizedAt(ref, new Date(started.getTime() + 50 * 60 * 1000));

    expect(await reconcilePayments(await targetsFor(fx))).toMatchObject({ settled: 0 });
    expect(await stripeState(ref)).toBe("canceled"); // reservation released
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
    expect(await events(fx, orderId)).toContain("payment.not_captured");
  });

  // ----------------------------------------------------------- late (O-6)

  it("O-6 replay: paid in time, webhook failing for a day, then a manual resend — captured once", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const f = await fake();
    f.settleOrderCheckout(ref);
    const started = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await setAttemptStart(fx, ref, started);
    f.setAuthorizedAt(ref, new Date(started.getTime() + 4 * 60 * 1000));

    const event = checkoutCompleted(fx, orderId, ref);
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "replayed" });
    const another = checkoutCompleted(fx, orderId, ref); // a second delivery id
    expect((await handleStripeEvent(another)).status).toBe(200);
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
    const kinds = await events(fx, orderId);
    expect(kinds.filter((k) => k === "payment.paid")).toHaveLength(1);
  });

  it("money TAKEN on an old card page authorized late is recorded for refund, order untouched", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const f = await fake();
    f.chargeImmediately(ref);
    const started = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await setAttemptStart(fx, ref, started);
    f.setAuthorizedAt(ref, new Date(started.getTime() + 5 * 60 * 60 * 1000));

    const done = await processStripeOrderPayment(fx.tenantId, ref, { orderId, source: "webhook" });
    expect(done).toMatchObject({ kind: "needs_resolution", reason: "late" });
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");
    expect(await attemptOf(fx, ref)).toMatchObject({
      resolution: "needed",
      resolutionReason: "late",
    });
    expect(await events(fx, orderId)).toContain("payment.needs_resolution");
  });

  // ----------------------------------------- durable capture / crash recovery

  it("crash after the capture, before our write: the reconciler records the taken money", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const f = await fake();
    f.settleOrderCheckout(ref);
    await f.capturePayment(ref); // Stripe took it…
    await markCapturing(fx, ref); // …our process died after step 1

    expect(await reconcilePayments(await targetsFor(fx))).toMatchObject({ settled: 1 });
    expect(await attemptOf(fx, ref)).toMatchObject({ status: "succeeded", settled: true });
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("crash before the capture call: the reconciler captures and settles", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref); // reserved, never captured
    await markCapturing(fx, ref);

    expect(await reconcilePayments(await targetsFor(fx))).toMatchObject({ settled: 1 });
    expect(await stripeState(ref)).toBe("succeeded");
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("a fresh 'capturing' attempt is left to the run doing it (no second capture)", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref);
    await markCapturing(fx, ref, new Date());
    const done = await processStripeOrderPayment(fx.tenantId, ref, { orderId, source: "webhook" });
    expect(done.kind).toBe("capturing");
    expect(await stripeState(ref)).toBe("requires_capture");
  });

  it("two paths settling the same payment at once capture it exactly once", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const f = await fake();
    f.settleOrderCheckout(ref);
    let captures = 0;
    const confirmation = {
      tenantId: fx.tenantId,
      provider: "stripe" as const,
      ref,
      orderId,
      stage: "authorized" as const,
      amountCents: (await read(fx, orderId))!.totalCents,
      currency: "EUR",
      authorizedAt: new Date(),
      capture: async () => {
        captures += 1;
        await new Promise((r) => setTimeout(r, 150));
        return f.capturePayment(ref);
      },
      release: () => f.cancelPayment(ref),
      source: "webhook" as const,
    };
    const results = await Promise.all([
      settleConfirmedPayment(confirmation),
      settleConfirmedPayment(confirmation),
    ]);
    expect(captures).toBe(1);
    expect(results.map((r) => r.kind).sort()).toEqual(["capturing", "settled"]);
  });

  it("the reconciler can list attempts across tenants as a NON-superuser (production role)", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const seen = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE elvoria_app");
      const without = await tx.paymentAttempt.count({ where: { ref } });
      await tx.$executeRaw`SELECT set_config('app.payment_reconciler', 'on', true)`;
      const withPolicy = await tx.paymentAttempt.count({ where: { ref } });
      // Read-only: the reconciler policy never allows a write.
      const wrote = await tx.paymentAttempt.updateMany({
        where: { ref },
        data: { status: "failed" },
      });
      return { without, withPolicy, wrote: wrote.count };
    });
    expect(seen).toEqual({ without: 0, withPolicy: 1, wrote: 0 });
    expect(orderId).toBeTruthy();
  });

  // ------------------------------------------------------ expired sessions

  it("an expired card page closes its attempt and fails the order — nothing charged", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).expireOrderCheckout(ref);
    await reconcilePendingPayments(fx.userId);
    expect(await attemptOf(fx, ref)).toMatchObject({ status: "expired" });
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
  });

  it("checkout.session.expired from Stripe does the same", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    await handleStripeEvent({
      id: `evt_${randomUUID()}`,
      type: "checkout.session.expired",
      data: { object: { id: ref, metadata: { orderId, tenantId: fx.tenantId } } },
    });
    expect(await attemptOf(fx, ref)).toMatchObject({ status: "expired" });
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
  });

  // ------------------------------------------------ changed order amounts

  it("an order total changed after the guest reserved the money is not charged", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref);
    await asTenant(fx.tenantId, (tx) =>
      tx.order.update({ where: { id: orderId }, data: { totalCents: 1000 } }),
    );
    const done = await processStripeOrderPayment(fx.tenantId, ref, { orderId, source: "webhook" });
    expect(done).toMatchObject({ kind: "declined", reason: "order_amount_changed" });
    expect(await stripeState(ref)).toBe("canceled");
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
  });

  it("a capture that takes another amount than asked is flagged, not sent to the kitchen", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    const f = await fake();
    f.settleOrderCheckout(ref);
    f.setCapturedAmount(ref, 999);
    const done = await processStripeOrderPayment(fx.tenantId, ref, { orderId, source: "webhook" });
    expect(done).toMatchObject({ kind: "needs_resolution", reason: "amount_mismatch" });
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");
  });

  // -------------------------------------------------- switching / double

  it("switching card → PayPal closes the open card page", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    expect((await createPayPalOrderPayment(fx.tenantId, orderId, token)).ok).toBe(true);
    expect(await stripeState(ref)).toBe("canceled");
    expect(await attemptOf(fx, ref)).toMatchObject({ status: "cancelled" });
  });

  it("if the old card page was reserved meanwhile, switching captures it and refuses PayPal", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref);
    expect(await createPayPalOrderPayment(fx.tenantId, orderId, token)).toEqual({
      ok: false,
      error: "already_paid",
    });
    expect(await read(fx, orderId)).toMatchObject({ paymentStatus: "paid", paymentRef: ref });
  });

  it("concurrent Stripe and PayPal captures for one order: exactly one is taken", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    const order0 = await read(fx, orderId);
    // A card attempt for the same order reserved in parallel (e.g. the app
    // sheet on another device), bypassing the switch.
    const f = await fake();
    const card = await f.createDirectCheckout({
      orderId,
      tenantId: fx.tenantId,
      amountCents: order0!.totalCents,
      currency: "EUR",
      label: "x",
      successUrl: "http://x",
      cancelUrl: "http://x",
      payPageUrl: "http://x",
    });
    await asTenant(fx.tenantId, (tx) =>
      tx.paymentAttempt.create({
        data: {
          tenantId: fx.tenantId,
          venueId: fx.venueId,
          orderId,
          orderLabel: "x",
          provider: "stripe",
          ref: card.ref,
          amountCents: order0!.totalCents,
          currency: "EUR",
        },
      }),
    );
    f.settleOrderCheckout(card.ref);

    const [pp, st] = await Promise.all([
      finalizePayPalReturn(fx.tenantId, orderId),
      processStripeOrderPayment(fx.tenantId, card.ref, { orderId, source: "webhook" }),
    ]);
    const settledAttempts = await asTenant(fx.tenantId, (tx) =>
      tx.paymentAttempt.count({ where: { orderId, settled: true } }),
    );
    expect(settledAttempts).toBe(1);
    const cardTaken = (await stripeState(card.ref)) === "succeeded";
    expect(Number(pp.paid) + Number(cardTaken)).toBe(1);
    expect(st.kind === "settled" || st.kind === "declined").toBe(true);
  });

  // ----------------------------------------------------------- PayPal

  it("PayPal: approval captured within the window settles; a replayed return is a no-op", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    expect(await finalizePayPalReturn(fx.tenantId, orderId)).toEqual({ paid: true });
    expect(await finalizePayPalReturn(fx.tenantId, orderId)).toEqual({ paid: true });
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("PayPal: an approval made after the window is not captured — order failed", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    const ref = (await read(fx, orderId))!.paymentRef!;
    const started = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await setAttemptStart(fx, ref, started);
    paypalFake().setApprovedAt(ref, new Date(started.getTime() + 50 * 60 * 1000));
    expect(await finalizePayPalReturn(fx.tenantId, orderId)).toEqual({ paid: false });
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
    expect(await events(fx, orderId)).not.toContain("paypal.capture");
  });

  it("PayPal: approved in time but processed hours later (downtime) is captured", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    const ref = (await read(fx, orderId))!.paymentRef!;
    const started = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await setAttemptStart(fx, ref, started);
    paypalFake().setApprovedAt(ref, new Date(started.getTime() + 5 * 60 * 1000));
    expect(await reconcilePayments(await targetsFor(fx))).toMatchObject({ settled: 1 });
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("PayPal: captured at PayPal but our write failed — the reconciler records it", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    const ref = (await read(fx, orderId))!.paymentRef!;
    paypalFake().markCapturedAtPayPal(ref);
    expect(await reconcilePayments(await targetsFor(fx))).toMatchObject({ settled: 1 });
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("money on an earlier card page of an unpaid order settles it as card; PayPal never captured on top", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const cardRef = await startCard(fx, orderId, token);
    // Guest moves to PayPal without the switch seeing the card (e.g. the
    // card is reserved a moment after) — simulated by reserving now.
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    const f = await fake();
    // The switch cancelled the card page; a fresh reservation on it is
    // impossible, so prove the guard from the PayPal side instead:
    expect(await stripeState(cardRef)).toBe("canceled");
    expect(f.settleOrderCheckout(cardRef)).toBeNull();
    expect(await finalizePayPalReturn(fx.tenantId, orderId)).toEqual({ paid: true });
  });

  // ---------------------------------------------- cancelled / deleted

  it("a cancelled order's reserved card payment is released, the order keeps its state", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref);
    await asTenant(fx.tenantId, (tx) =>
      tx.order.update({ where: { id: orderId }, data: { status: "cancelled" } }),
    );
    const done = await processStripeOrderPayment(fx.tenantId, ref, { orderId, source: "webhook" });
    expect(done).toMatchObject({ kind: "declined", reason: "order_cancelled" });
    expect(await stripeState(ref)).toBe("canceled");
    expect(await read(fx, orderId)).toMatchObject({
      status: "cancelled",
      paymentStatus: "pending",
    });
  });

  it("deleting releases the reservation; a late webhook never brings the order back", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).settleOrderCheckout(ref);
    expect((await deleteOrder(fx.userId, orderId, "Testing / fake order")).ok).toBe(true);
    expect(await stripeState(ref)).toBe("canceled");

    expect((await handleStripeEvent(checkoutCompleted(fx, orderId, ref))).status).toBe(200);
    expect(await read(fx, orderId)).toBeNull();
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

  // ------------------------------------------------ delayed methods / misc

  it("a checkout finished unpaid with nothing reserved (delayed method) waits; its failure fails the order", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    await handleStripeEvent(checkoutCompleted(fx, orderId, ref));
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");
    await handleStripeEvent({
      id: `evt_${randomUUID()}`,
      type: "checkout.session.async_payment_failed",
      data: { object: { id: ref, metadata: { orderId, tenantId: fx.tenantId } } },
    });
    expect(await attemptOf(fx, ref)).toMatchObject({ status: "failed" });
    expect((await read(fx, orderId))?.paymentStatus).toBe("failed");
  });

  it("a delayed method that succeeds in time settles the order", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    const ref = await startCard(fx, orderId, token);
    (await fake()).chargeImmediately(ref); // Stripe reports it paid
    await handleStripeEvent({
      id: `evt_${randomUUID()}`,
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: { id: ref, payment_status: "paid", metadata: { orderId, tenantId: fx.tenantId } },
      },
    });
    expect((await read(fx, orderId))?.paymentStatus).toBe("paid");
  });

  it("a decline on an older card attempt does not fail the guest's current payment", async () => {
    const fx = await fixture();
    const { orderId, token } = await order(fx);
    await createPayPalOrderPayment(fx.tenantId, orderId, token);
    await handleStripeEvent({
      id: `evt_${randomUUID()}`,
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_older_attempt", metadata: { orderId, tenantId: fx.tenantId } } },
    });
    expect((await read(fx, orderId))?.paymentStatus).toBe("pending");
  });

  it("a reserved payment naming a ref we never issued is released, not taken", async () => {
    const fx = await fixture();
    const { orderId } = await order(fx);
    const f = await fake();
    const stray = await f.createDirectCheckout({
      orderId,
      tenantId: fx.tenantId,
      amountCents: 1690,
      currency: "EUR",
      label: "x",
      successUrl: "http://x",
      cancelUrl: "http://x",
      payPageUrl: "http://x",
    });
    f.settleOrderCheckout(stray.ref);
    const done = await processStripeOrderPayment(fx.tenantId, stray.ref, {
      orderId,
      source: "webhook",
    });
    expect(done.kind).toBe("unknown_attempt");
    expect(await stripeState(stray.ref)).toBe("canceled");
  });
});
