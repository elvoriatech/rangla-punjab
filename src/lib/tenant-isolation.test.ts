import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { asTenant } from "./tenant";

// Integration test: proves RLS enforces tenant isolation at the database.
// Requires the local Postgres (docker-compose) with migrations applied.
describe("tenant isolation (RLS)", () => {
  const idA = randomUUID();
  const idB = randomUUID();
  const slugA = `venue-a-${idA.slice(0, 8)}`;
  const slugB = `venue-b-${idB.slice(0, 8)}`;

  it("scopes reads to the active tenant and blocks cross-tenant reads", async () => {
    // Seed each tenant under its own GUC. WITH CHECK proves the write is legal.
    await asTenant(idA, (tx) => tx.tenant.create({ data: { id: idA, name: "Tenant A" } }));
    await asTenant(idB, (tx) => tx.tenant.create({ data: { id: idB, name: "Tenant B" } }));
    await asTenant(idA, (tx) =>
      tx.venue.create({ data: { tenantId: idA, name: "A", slug: slugA } }),
    );
    await asTenant(idB, (tx) =>
      tx.venue.create({ data: { tenantId: idB, name: "B", slug: slugB } }),
    );

    // A sees only A's venue.
    const aVenues = await asTenant(idA, (tx) => tx.venue.findMany());
    expect(aVenues.map((v) => v.slug)).toEqual([slugA]);

    // An explicit cross-tenant filter still returns nothing — RLS, not app code.
    const leak = await asTenant(idA, (tx) => tx.venue.findMany({ where: { tenantId: idB } }));
    expect(leak).toHaveLength(0);

    // B sees only B's venue.
    const bVenues = await asTenant(idB, (tx) => tx.venue.findMany());
    expect(bVenues.map((v) => v.slug)).toEqual([slugB]);
  });

  it("blocks writing a row for another tenant (WITH CHECK)", async () => {
    await expect(
      asTenant(idA, (tx) =>
        tx.venue.create({
          data: { tenantId: idB, name: "evil", slug: `evil-${randomUUID().slice(0, 8)}` },
        }),
      ),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    await asTenant(idA, (tx) => tx.venue.deleteMany({}));
    await asTenant(idB, (tx) => tx.venue.deleteMany({}));
    await asTenant(idA, (tx) => tx.tenant.deleteMany({}));
    await asTenant(idB, (tx) => tx.tenant.deleteMany({}));
    await prisma.$disconnect();
  });
});
