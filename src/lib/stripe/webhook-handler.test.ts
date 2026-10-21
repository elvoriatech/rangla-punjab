import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { asTenant } from "../tenant";
import { signupUser } from "../auth-service";
import type { StripeEvent } from "./provider";
import { handleStripeEvent } from "./webhook-handler";
import { getStripeProvider } from "./index";
import type { FakeStripeProvider } from "./fake-provider";

type FakeStripe = FakeStripeProvider;

async function seedTenant(): Promise<{ tenantId: string; userId: string }> {
  const signup = await signupUser({
    email: `p1-19c-${randomUUID()}@ex.com`,
    password: "S3cureP4ssPhrase!",
    tenantName: "Stripe test",
  });
  if (!signup.ok) throw new Error("signup failed");
  return { tenantId: signup.tenantId, userId: signup.userId };
}

describe("handleStripeEvent (idempotent webhook dispatcher)", () => {
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdTenantIds.length = 0;
    createdUserIds.length = 0;
  });

  it("replaying the same event id is a no-op (idempotency guard)", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    // Proved on account.updated rather than a subscription row: the claim
    // is about the WebhookEvent guard, not about what any one handler
    // writes, and subscriptions no longer exist in this build.
    const accountId = `acct_${randomUUID().slice(0, 12)}`;
    await asTenant(tenantId, (tx) =>
      tx.tenant.updateMany({ data: { stripeAccountId: accountId, stripeChargesEnabled: false } }),
    );

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "account.updated",
      data: { object: { id: accountId, charges_enabled: true, metadata: { tenantId } } },
    };

    const first = await handleStripeEvent(event);
    expect(first.kind).toBe("processed");

    // Flip it back by hand. A second delivery that actually ran would set
    // it to true again; a correctly-guarded replay leaves it alone.
    await asTenant(tenantId, (tx) =>
      tx.tenant.updateMany({ data: { stripeChargesEnabled: false } }),
    );

    const second = await handleStripeEvent(event);
    expect(second.kind).toBe("replayed");

    const tenant = await asTenant(tenantId, (tx) =>
      tx.tenant.findFirstOrThrow({ select: { stripeChargesEnabled: true } }),
    );
    expect(tenant.stripeChargesEnabled).toBe(false);
  });

  it("unknown event types are 200-ignored", async () => {
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "invoice.upcoming",
      data: { object: {} },
    };
    const outcome = await handleStripeEvent(event);
    expect(outcome).toEqual({ status: 200, kind: "ignored" });
  });

  it("checkout.session.completed without a metadata.tenantId is a no-op (logged, not thrown)", async () => {
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    };
    const outcome = await handleStripeEvent(event);
    expect(outcome.kind).toBe("processed");
    // The assertion is that a checkout session carrying neither an orderId
    // nor a usable tenant is logged and shrugged off rather than thrown on.
  });

  /**
   * A pending card order the way createOrderPayment leaves it: a payment
   * page (or app intent) on the fake provider, the order pointing at it,
   * and its payment attempt holding the amount.
   */
  async function pendingCardOrder(
    tenantId: string,
    opts: { orderNumber: number; totalCents: number; appSheet?: boolean },
  ): Promise<{ orderId: string; ref: string; fake: FakeStripe }> {
    const fake = (await getStripeProvider()) as unknown as FakeStripe;
    return asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId, name: "Hook Venue", slug: `hook-${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      const order = await tx.order.create({
        data: {
          tenantId,
          venueId: venue.id,
          orderType: "dine_in",
          orderNumber: opts.orderNumber,
          currency: "EUR",
          totalCents: opts.totalCents,
          paymentStatus: "pending",
          paymentProvider: "stripe",
        },
        select: { id: true },
      });
      const input = {
        orderId: order.id,
        tenantId,
        amountCents: opts.totalCents,
        currency: "EUR",
        label: "Hook",
        successUrl: "http://x/s",
        cancelUrl: "http://x/c",
        payPageUrl: "http://x/p",
      };
      const { ref } = opts.appSheet
        ? await fake.createDirectPaymentIntent(input)
        : await fake.createDirectCheckout(input);
      await tx.order.update({ where: { id: order.id }, data: { paymentRef: ref } });
      await tx.paymentAttempt.create({
        data: {
          tenantId,
          venueId: venue.id,
          orderId: order.id,
          orderLabel: String(opts.orderNumber),
          provider: "stripe",
          ref,
          amountCents: opts.totalCents,
          currency: "EUR",
        },
      });
      return { orderId: order.id, ref, fake };
    });
  }

  it("checkout.session.completed: the reserved card payment is captured and the order paid", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);
    const { orderId, ref, fake } = await pendingCardOrder(tenantId, {
      orderNumber: 1,
      totalCents: 2980,
    });
    fake.settleOrderCheckout(ref); // the guest pays: the card is reserved

    // Authorize-only: Stripe reports the session as completed but UNPAID;
    // the server captures and only then is the order paid.
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { id: ref, payment_status: "unpaid", metadata: { orderId, tenantId } } },
    };
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });
    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(order.paymentStatus).toBe("paid");
    expect((await fake.retrievePaymentIntent(ref))?.status).toBe("succeeded");
  });

  it("app sheet: an authorized PaymentIntent is captured and the order paid", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);
    const { orderId, ref, fake } = await pendingCardOrder(tenantId, {
      orderNumber: 2,
      totalCents: 2490,
      appSheet: true,
    });
    fake.settleOrderCheckout(ref);
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.amount_capturable_updated",
      data: { object: { id: ref, metadata: { orderId, tenantId } } },
    };
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });
    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(order.paymentStatus).toBe("paid");
  });

  it("payment_intent.payment_failed marks the order failed — and a retry that succeeds still settles it", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);
    const { orderId, ref, fake } = await pendingCardOrder(tenantId, {
      orderNumber: 3,
      totalCents: 1200,
      appSheet: true,
    });

    const declined: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.payment_failed",
      data: { object: { id: ref, metadata: { orderId, tenantId } } },
    };
    expect((await handleStripeEvent(declined)).status).toBe(200);
    const failed = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    // The guest is shown "Payment failed" (retry / pay cash / cancel) and
    // the order stays off the kitchen board.
    expect(failed.paymentStatus).toBe("failed");

    // Another card on the same sheet, this time accepted: it settles.
    fake.settleOrderCheckout(ref);
    const retried: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.amount_capturable_updated",
      data: { object: { id: ref, metadata: { orderId, tenantId } } },
    };
    expect((await handleStripeEvent(retried)).status).toBe(200);
    const settled = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(settled.paymentStatus).toBe("paid");
  });

  /**
   * A gift-card purchase rides the SAME `payment_intent.succeeded` event
   * as an order, told apart only by which metadata key is set. Settling
   * one as the other would either print a kitchen ticket for food nobody
   * ordered, or leave a paid card unspendable — so both halves are
   * asserted: the card activates, and the order in the same tenant does
   * not move.
   */
  async function seedCardAndOrder(tenantId: string): Promise<{ cardId: string; orderId: string }> {
    return asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId, name: "Gift Venue", slug: `gift-${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      const customer = await tx.customer.create({
        data: {
          tenantId,
          provider: "dev",
          providerSub: `dev:${randomUUID()}`,
          email: `buyer-${randomUUID().slice(0, 8)}@ex.com`,
        },
        select: { id: true },
      });
      const card = await tx.giftCard.create({
        data: {
          tenantId,
          venueId: venue.id,
          code: randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
          purchaserCustomerId: customer.id,
          valueCents: 5000,
          currency: "EUR",
          status: "pending_payment",
        },
        select: { id: true },
      });
      const order = await tx.order.create({
        data: {
          tenantId,
          venueId: venue.id,
          orderType: "dine_in",
          orderNumber: 4,
          currency: "EUR",
          totalCents: 1990,
          paymentStatus: "pending",
        },
        select: { id: true },
      });
      return { cardId: card.id, orderId: order.id };
    });
  }

  it("payment_intent.succeeded with a giftCardId activates the card and touches no order", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);
    const { cardId, orderId } = await seedCardAndOrder(tenantId);

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: {
        object: { id: "pi_gift", amount: 5000, metadata: { giftCardId: cardId, tenantId } },
      },
    };
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });

    const card = await asTenant(tenantId, (tx) =>
      tx.giftCard.findFirstOrThrow({
        where: { id: cardId },
        select: {
          status: true,
          paidAt: true,
          expiresAt: true,
          paymentProvider: true,
          paymentRef: true,
        },
      }),
    );
    expect(card).toMatchObject({
      status: "active",
      paymentProvider: "stripe",
      paymentRef: "pi_gift",
    });
    // The money arriving is what starts the card's clock.
    expect(card.paidAt).toBeInstanceOf(Date);
    expect(card.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    // The pending order in the same tenant is none of this event's business.
    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(order.paymentStatus).toBe("pending");
  });

  it("a replayed gift-card event does not re-settle the card", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);
    const { cardId } = await seedCardAndOrder(tenantId);

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: {
        object: { id: "pi_gift_replay", amount: 5000, metadata: { giftCardId: cardId, tenantId } },
      },
    };
    expect((await handleStripeEvent(event)).kind).toBe("processed");

    // Put the card back by hand. A second delivery that actually ran would
    // activate it again — and re-stamp `paidAt`, silently extending the
    // card by however long Stripe's retry was delayed. A correctly-guarded
    // replay leaves it exactly where it is.
    await asTenant(tenantId, (tx) =>
      tx.giftCard.updateMany({
        where: { id: cardId },
        data: { status: "pending_payment", paidAt: null, expiresAt: null },
      }),
    );

    expect((await handleStripeEvent(event)).kind).toBe("replayed");
    expect(
      await asTenant(tenantId, (tx) =>
        tx.giftCard.findFirstOrThrow({
          where: { id: cardId },
          select: { status: true, paidAt: true, expiresAt: true },
        }),
      ),
    ).toEqual({ status: "pending_payment", paidAt: null, expiresAt: null });
  });

  it("a gift-card payment with no tenant in its metadata is logged, not thrown on", async () => {
    // Without a tenant there is no GUC to set and therefore no card we may
    // legally touch. Shrugging it off beats 500-ing at Stripe forever.
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_orphan", metadata: { giftCardId: "cmu_nope" } } },
    };
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });
  });

  it("account.updated mirrors charges_enabled onto the tenant", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const accountId = `acct_${randomUUID().slice(0, 12)}`;
    await asTenant(tenantId, (tx) =>
      tx.tenant.updateMany({ data: { stripeAccountId: accountId, stripeChargesEnabled: false } }),
    );

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "account.updated",
      data: { object: { id: accountId, charges_enabled: true, metadata: { tenantId } } },
    };
    const outcome = await handleStripeEvent(event);
    expect(outcome).toEqual({ status: 200, kind: "processed" });

    const tenant = await asTenant(tenantId, (tx) =>
      tx.tenant.findFirstOrThrow({ select: { stripeChargesEnabled: true } }),
    );
    expect(tenant.stripeChargesEnabled).toBe(true);
  });
});
