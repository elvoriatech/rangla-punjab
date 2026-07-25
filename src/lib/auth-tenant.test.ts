import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { asTenant, asUser, NoActiveTenantError, resolveActiveTenantId } from "./tenant";

// Integration test for P1-1's auth → tenant → RLS pipeline. Seeds two
// tenants and one owner per tenant, then proves that `asUser` scopes reads
// to the caller's tenant even when the other tenant's rows exist.
//
// Requires the local Postgres (docker-compose) with all migrations applied
// (`prisma migrate deploy`) — the SECURITY DEFINER `resolve_active_tenant`
// function must be present.

describe("asUser (session → tenant → RLS)", () => {
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const userOrphanId = randomUUID();
  const slugA = `p1-1-a-${tenantAId.slice(0, 8)}`;
  const slugB = `p1-1-b-${tenantBId.slice(0, 8)}`;

  beforeAll(async () => {
    // Seed both tenants + venues under the correct tenant GUC each time so
    // WITH CHECK proves each write is legal.
    await asTenant(tenantAId, (tx) => tx.tenant.create({ data: { id: tenantAId, name: "A" } }));
    await asTenant(tenantBId, (tx) => tx.tenant.create({ data: { id: tenantBId, name: "B" } }));
    await asTenant(tenantAId, (tx) =>
      tx.venue.create({ data: { tenantId: tenantAId, name: "A", slug: slugA } }),
    );
    await asTenant(tenantBId, (tx) =>
      tx.venue.create({ data: { tenantId: tenantBId, name: "B", slug: slugB } }),
    );

    // Users live outside RLS. Memberships are RLS-scoped, so we open them
    // under each user's target tenant GUC.
    await prisma.user.createMany({
      data: [
        { id: userAId, email: `a-${userAId}@ex.com`, passwordHash: "x" },
        { id: userBId, email: `b-${userBId}@ex.com`, passwordHash: "x" },
        { id: userOrphanId, email: `o-${userOrphanId}@ex.com`, passwordHash: "x" },
      ],
    });
    await asTenant(tenantAId, (tx) =>
      tx.membership.create({ data: { userId: userAId, tenantId: tenantAId, role: "owner" } }),
    );
    await asTenant(tenantBId, (tx) =>
      tx.membership.create({ data: { userId: userBId, tenantId: tenantBId, role: "owner" } }),
    );
    // userOrphan intentionally has zero memberships.
  });

  it("resolves the active tenant for a user with a single membership", async () => {
    expect(await resolveActiveTenantId(userAId)).toBe(tenantAId);
    expect(await resolveActiveTenantId(userBId)).toBe(tenantBId);
  });

  it("scopes reads to the caller's tenant when another tenant's rows exist", async () => {
    const aVenues = await asUser(userAId, (tx) => tx.venue.findMany());
    expect(aVenues.map((v) => v.slug)).toEqual([slugA]);

    // Even an explicit cross-tenant filter returns nothing — the DB, not app
    // code, is the isolation boundary (CLAUDE.md).
    const leak = await asUser(userAId, (tx) =>
      tx.venue.findMany({ where: { tenantId: tenantBId } }),
    );
    expect(leak).toHaveLength(0);

    const bVenues = await asUser(userBId, (tx) => tx.venue.findMany());
    expect(bVenues.map((v) => v.slug)).toEqual([slugB]);
  });

  it("throws NoActiveTenantError for a user with no memberships", async () => {
    await expect(asUser(userOrphanId, (tx) => tx.venue.findMany())).rejects.toBeInstanceOf(
      NoActiveTenantError,
    );
    expect(await resolveActiveTenantId(userOrphanId)).toBeNull();
  });

  afterAll(async () => {
    await asTenant(tenantAId, (tx) => tx.membership.deleteMany({}));
    await asTenant(tenantBId, (tx) => tx.membership.deleteMany({}));
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId, userOrphanId] } } });
    await asTenant(tenantAId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantBId, (tx) => tx.venue.deleteMany({}));
    await asTenant(tenantAId, (tx) => tx.tenant.deleteMany({}));
    await asTenant(tenantBId, (tx) => tx.tenant.deleteMany({}));
    await prisma.$disconnect();
  });
});
