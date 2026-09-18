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
