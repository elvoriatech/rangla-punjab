import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { asTenant, asUser } from "./tenant";
import { signupUser } from "./auth-service";

/**
 * RLS check for the extended `subscriptions` table (P1-19a). The
 * subscriptions policy was set up in P0-4 alongside every other tenant-
 * scoped table; this test proves the extension didn't quietly disable
 * it — and that the new columns (`trialEnd`, `cancelAt`, `deletedAt`)
 * respect the policy too.
 */

describe("subscriptions RLS", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.subscription.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  async function seedTenant(): Promise<{ userId: string; tenantId: string }> {
    const signup = await signupUser({
      email: `p1-19a-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Placeholder",
    });
    if (!signup.ok) throw new Error("signup failed");
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    return { userId: signup.userId, tenantId: signup.tenantId };
  }

  it("a tenant can create + read its own subscription with the new columns", async () => {
    const { userId, tenantId } = await seedTenant();
    const trialEnd = new Date(Date.now() + 14 * 86400 * 1000);
    await asUser(userId, (tx) =>
      tx.subscription.create({
        data: {
          tenantId,
          planCode: "starter",
          status: "trialing",
          trialEnd,
        },
      }),
    );
    const sub = await asUser(userId, (tx) => tx.subscription.findFirstOrThrow());
    expect(sub.planCode).toBe("starter");
    expect(sub.status).toBe("trialing");
    expect(sub.trialEnd?.getTime()).toBe(trialEnd.getTime());
    expect(sub.cancelAt).toBeNull();
    expect(sub.deletedAt).toBeNull();
  });

  it("RLS blocks tenant B from reading tenant A's subscription", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    await asUser(a.userId, (tx) =>
      tx.subscription.create({
        data: { tenantId: a.tenantId, planCode: "starter", status: "trialing" },
      }),
    );
    // User B scoped to their own tenant should see zero subscriptions —
    // even an explicit `where: { tenantId: a.tenantId }` returns nothing
    // because RLS is the boundary, not the app-side filter.
    const leak = await asUser(b.userId, (tx) =>
      tx.subscription.findMany({ where: { tenantId: a.tenantId } }),
    );
    expect(leak).toHaveLength(0);

    const seenByA = await asUser(a.userId, (tx) => tx.subscription.findMany());
    expect(seenByA).toHaveLength(1);
  });

  it("partial unique lets a resubscribe happen after soft-delete of the previous row", async () => {
    const { userId, tenantId } = await seedTenant();
    // First subscription — created, then soft-deleted.
    await asUser(userId, (tx) =>
      tx.subscription.create({
        data: { tenantId, planCode: "starter", status: "canceled", deletedAt: new Date() },
      }),
    );
    // Second subscription for the same tenant should succeed because the
    // partial unique only covers `deleted_at IS NULL`.
    await expect(
      asUser(userId, (tx) =>
        tx.subscription.create({
          data: { tenantId, planCode: "growth", status: "trialing" },
        }),
      ),
    ).resolves.toMatchObject({ planCode: "growth" });
  });
});
