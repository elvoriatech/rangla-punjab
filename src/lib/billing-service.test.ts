import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { asTenant, asUser } from "./tenant";
import { signupUser } from "./auth-service";
import { createBillingPortal, createCheckout } from "./billing-service";

async function seed(): Promise<{ tenantId: string; userId: string; email: string }> {
  const email = `p1-19e-${randomUUID()}@ex.com`;
  const signup = await signupUser({
    email,
    password: "S3cureP4ssPhrase!",
    tenantName: "Billing test",
  });
  if (!signup.ok) throw new Error("signup failed");
  return { tenantId: signup.tenantId, userId: signup.userId, email };
}

describe("billing-service", () => {
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

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

  it("createCheckout on a fresh tenant creates a Stripe customer, persists it, and returns a URL", async () => {
    const { tenantId, userId } = await seed();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const result = await createCheckout(userId, "support", {
      successUrl: "https://elvoria.eu/ok",
      cancelUrl: "https://elvoria.eu/cancel",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toMatch(/^https:\/\/fake-stripe\.local\/checkout\//);

    // Customer id was persisted so the *next* call reuses it.
    const sub = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(sub.stripeCustomerId).toMatch(/^cus_fake_/);
    expect(sub.status).toBe("incomplete");
  });

  it("createCheckout reuses an existing stripe_customer_id for the second call", async () => {
    const { tenantId, userId } = await seed();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    await createCheckout(userId, "support", {
      successUrl: "https://elvoria.eu/ok",
      cancelUrl: "https://elvoria.eu/cancel",
    });
    const after1 = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    const firstCustomer = after1.stripeCustomerId;

    await createCheckout(userId, "support", {
      successUrl: "https://elvoria.eu/ok",
      cancelUrl: "https://elvoria.eu/cancel",
    });
    const after2 = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(after2.stripeCustomerId).toBe(firstCustomer);
  });

  it("createBillingPortal 404s when no stripe_customer_id is on file", async () => {
    const { tenantId, userId } = await seed();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    const result = await createBillingPortal(userId, "https://elvoria.eu/dashboard/billing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("no_customer");
  });

  it("createBillingPortal returns a URL after a checkout has landed a customer id", async () => {
    const { tenantId, userId } = await seed();
    createdTenantIds.push(tenantId);
    createdUserIds.push(userId);

    await createCheckout(userId, "support", {
      successUrl: "https://elvoria.eu/ok",
      cancelUrl: "https://elvoria.eu/cancel",
    });
    const result = await createBillingPortal(userId, "https://elvoria.eu/dashboard/billing");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toMatch(/^https:\/\/fake-stripe\.local\/portal\//);
      expect(result.url).toContain(encodeURIComponent("https://elvoria.eu/dashboard/billing"));
    }
  });
});
