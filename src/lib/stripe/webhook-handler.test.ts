import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { asTenant } from "../tenant";
import { signupUser } from "../auth-service";
import type { StripeEvent } from "./provider";
import { handleStripeEvent } from "./webhook-handler";

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

  it("checkout.session.completed with an orderId settles the guest order (Connect payment)", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    // Minimal venue + pending-payment order, as createOrderPayment leaves it.
    const orderId = await asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId, name: "Hook Venue", slug: `hook-${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      const order = await tx.order.create({
        data: {
          tenantId,
          venueId: venue.id,
          orderType: "dine_in",
          orderNumber: 1,
          currency: "EUR",
          totalCents: 2980,
          paymentStatus: "pending",
          paymentRef: `cs_${randomUUID()}`,
        },
        select: { id: true },
      });
      return order.id;
    });

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { metadata: { orderId, tenantId } } },
    };
    const outcome = await handleStripeEvent(event);
    expect(outcome).toEqual({ status: 200, kind: "processed" });

    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(order.paymentStatus).toBe("paid");
  });

  it("payment_intent.succeeded settles the order paid in the app's native sheet", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const orderId = await asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId, name: "Sheet Venue", slug: `sheet-${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      const order = await tx.order.create({
        data: {
          tenantId,
          venueId: venue.id,
          orderType: "dine_in",
          orderNumber: 2,
          currency: "EUR",
          totalCents: 2490,
          paymentStatus: "pending",
          paymentRef: `pi_${randomUUID()}`,
        },
        select: { id: true },
      });
      return order.id;
    });

    // No checkout session exists for an in-app payment — the metadata on
    // the PaymentIntent itself is the whole routing key.
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_x", amount: 2490, metadata: { orderId, tenantId } } },
    };
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });

    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    expect(order.paymentStatus).toBe("paid");
  });

  it("payment_intent.succeeded without our metadata touches nothing", async () => {
    // Someone else's PaymentIntent on the same account (a manual charge in
    // the Stripe Dashboard, say) must not be mistaken for one of our orders.
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_unrelated", amount: 100 } },
    };
    expect(await handleStripeEvent(event)).toEqual({ status: 200, kind: "processed" });
  });

  it("payment_intent.payment_failed marks the order failed — and a retry that succeeds still settles it", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const orderId = await asTenant(tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: { tenantId, name: "Decline Venue", slug: `decl-${randomUUID().slice(0, 8)}` },
        select: { id: true },
      });
      const order = await tx.order.create({
        data: {
          tenantId,
          venueId: venue.id,
          orderType: "dine_in",
          orderNumber: 3,
          currency: "EUR",
          totalCents: 1200,
          paymentStatus: "pending",
        },
        select: { id: true },
      });
      return order.id;
    });

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_declined", metadata: { orderId, tenantId } } },
    };
    expect((await handleStripeEvent(event)).status).toBe(200);

    const order = await asTenant(tenantId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { paymentStatus: true } }),
    );
    // The guest is shown "Payment failed" (retry / pay cash / cancel) and
    // the order stays off the kitchen board.
    expect(order.paymentStatus).toBe("failed");

    // Another card, this time accepted: the order settles as usual.
    const retried: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_retry", metadata: { orderId, tenantId } } },
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
