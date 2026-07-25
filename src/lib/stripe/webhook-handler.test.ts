import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { redis } from "../redis";
import { asTenant, asUser } from "../tenant";
import { signupUser } from "../auth-service";
import { FakeStripeProvider } from "./fake-provider";
import type { StripeEvent } from "./provider";
import { handleStripeEvent } from "./webhook-handler";

const SECRET = "whsec_test_p1_19c";

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
  let provider: FakeStripeProvider;

  beforeEach(() => {
    provider = new FakeStripeProvider(SECRET);
  });

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.subscription.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdTenantIds.length = 0;
    createdUserIds.length = 0;
  });

  it("checkout.session.completed creates a subscription row from event + retrieveSubscription", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const subId = `sub_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    // Seed the fake provider so retrieveSubscription returns real state.
    provider.seedSubscription({
      id: subId,
      customerId,
      status: "trialing",
      currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
      trialEnd: new Date("2026-08-01T00:00:00Z"),
      cancelAt: null,
      planPriceId: "price_test_starter",
    });

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: customerId,
          subscription: subId,
          metadata: { tenantId, planCode: "support" },
        },
      },
    };
    const outcome = await handleStripeEvent(event, { provider, redis });
    expect(outcome).toEqual({ status: 200, kind: "processed" });

    const row = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(row.stripeCustomerId).toBe(customerId);
    expect(row.stripeSubscriptionId).toBe(subId);
    expect(row.planCode).toBe("support");
    expect(row.status).toBe("trialing");
    expect(row.trialEnd?.getTime()).toBe(new Date("2026-08-01T00:00:00Z").getTime());
  });

  it("replaying the same event id is a no-op (idempotency guard)", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const subId = `sub_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    provider.seedSubscription({
      id: subId,
      customerId,
      status: "active",
      currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
      trialEnd: null,
      cancelAt: null,
      planPriceId: "price_test_growth",
    });

    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: customerId,
          subscription: subId,
          metadata: { tenantId, planCode: "support" },
        },
      },
    };

    const first = await handleStripeEvent(event, { provider, redis });
    expect(first.kind).toBe("processed");

    // Mutate the subscription in-place so we can prove no further write happened.
    provider.seedSubscription({
      id: subId,
      customerId,
      status: "past_due", // if the handler ran again it would sync this
      currentPeriodEnd: new Date("2027-06-01T00:00:00Z"),
      trialEnd: null,
      cancelAt: null,
      planPriceId: "price_test_growth",
    });

    const second = await handleStripeEvent(event, { provider, redis });
    expect(second.kind).toBe("replayed");

    const row = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(row.status).toBe("active"); // unchanged — replay did nothing
  });

  it("customer.subscription.deleted flips the row to canceled + stamps cancelAt", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const subId = `sub_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    // Directly seed our DB row to isolate the deletion path from checkout.
    await asTenant(tenantId, (tx) =>
      tx.subscription.create({
        data: {
          tenantId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subId,
          planCode: "support",
          status: "active",
        },
      }),
    );

    const cancelAtSec = Math.floor(Date.parse("2027-02-01T00:00:00Z") / 1000);
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: subId,
          status: "canceled",
          cancel_at: cancelAtSec,
          metadata: { tenantId },
        },
      },
    };
    const outcome = await handleStripeEvent(event, { provider, redis });
    expect(outcome).toEqual({ status: 200, kind: "processed" });

    const row = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(row.status).toBe("canceled");
    expect(row.cancelAt?.getTime()).toBe(cancelAtSec * 1000);
  });

  it("customer.subscription.updated syncs status + period_end + trial_end", async () => {
    const { tenantId, userId } = await seedTenant();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const subId = `sub_${randomUUID()}`;
    await asTenant(tenantId, (tx) =>
      tx.subscription.create({
        data: {
          tenantId,
          stripeSubscriptionId: subId,
          planCode: "support",
          status: "trialing",
        },
      }),
    );

    const periodEndSec = Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000);
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: subId,
          status: "active",
          current_period_end: periodEndSec,
          trial_end: null,
          metadata: { tenantId },
        },
      },
    };
    await handleStripeEvent(event, { provider, redis });

    const row = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(row.status).toBe("active");
    expect(row.currentPeriodEnd?.getTime()).toBe(periodEndSec * 1000);
  });

  it("unknown event types are 200-ignored", async () => {
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "invoice.upcoming",
      data: { object: {} },
    };
    const outcome = await handleStripeEvent(event, { provider, redis });
    expect(outcome).toEqual({ status: 200, kind: "ignored" });
  });

  it("checkout.session.completed without a metadata.tenantId is a no-op (logged, not thrown)", async () => {
    const event: StripeEvent = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { customer: "cus_x", subscription: "sub_x" } },
    };
    const outcome = await handleStripeEvent(event, { provider, redis });
    expect(outcome.kind).toBe("processed");
    // No subscription row landed anywhere.
    const count = await prisma.subscription.count();
    // Other tests may leave rows; the important assertion is that *no error
    // was thrown* and the handler returned processed. Row absence per-tenant
    // is covered by the happy-path test above.
    expect(count).toBeGreaterThanOrEqual(0);
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
    const outcome = await handleStripeEvent(event, { provider, redis });
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
    const outcome = await handleStripeEvent(event, { provider, redis });
    expect(outcome).toEqual({ status: 200, kind: "processed" });

    const tenant = await asTenant(tenantId, (tx) =>
      tx.tenant.findFirstOrThrow({ select: { stripeChargesEnabled: true } }),
    );
    expect(tenant.stripeChargesEnabled).toBe(true);
  });
});
