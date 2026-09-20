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

  /**
   * Gift cards carry money, so they get the same two proofs the venue
   * does — and they need them more: a card is a BEARER instrument keyed
   * by a globally unique code, so the lookup that matters most
   * (`findGiftCardByCode`) never names a tenant in its `where`. RLS is
   * the only thing standing between one restaurant's cashier and another
   * restaurant's cards.
   */
  it("scopes gift card rows to the active tenant and blocks cross-tenant reads", async () => {
    const seed = async (tenantId: string, tag: string): Promise<string> =>
      asTenant(tenantId, async (tx) => {
        const venue = await tx.venue.create({
          data: { tenantId, name: tag, slug: `gc-${tag}-${randomUUID().slice(0, 8)}` },
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
        const product = await tx.giftCardProduct.create({
          data: { tenantId, venueId: venue.id, name: `${tag} design`, priceCents: 2500 },
          select: { id: true },
        });
        await tx.giftCard.create({
          data: {
            tenantId,
            venueId: venue.id,
            productId: product.id,
            code: `${tag}${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
            purchaserCustomerId: customer.id,
            valueCents: 2500,
            currency: "EUR",
            status: "active",
          },
        });
        return product.id;
      });

    const productA = await seed(idA, "A");
    await seed(idB, "B");

    // A sees exactly its own card and its own design.
    expect(await asTenant(idA, (tx) => tx.giftCard.findMany())).toHaveLength(1);
    expect(await asTenant(idA, (tx) => tx.giftCardProduct.findMany())).toHaveLength(1);

    // An explicit cross-tenant filter still returns nothing — RLS, not app code.
    expect(
      await asTenant(idA, (tx) => tx.giftCard.findMany({ where: { tenantId: idB } })),
    ).toHaveLength(0);
    expect(
      await asTenant(idA, (tx) => tx.giftCardProduct.findMany({ where: { tenantId: idB } })),
    ).toHaveLength(0);

    // And B's card cannot be found by code from A's session, which is the
    // lookup a cashier's redeem actually performs.
    const bCode = await asTenant(idB, (tx) =>
      tx.giftCard.findFirstOrThrow({ select: { code: true } }),
    );
    expect(
      await asTenant(idA, (tx) => tx.giftCard.findFirst({ where: { code: bCode.code } })),
    ).toBeNull();

    // The write half: A cannot mint a card or a design into B's books,
    // even naming B's own product.
    await expect(
      asTenant(idA, (tx) =>
        tx.giftCardProduct.create({
          data: { tenantId: idB, venueId: randomUUID(), name: "evil", priceCents: 1 },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(idA, (tx) =>
        tx.giftCard.create({
          data: {
            tenantId: idB,
            venueId: randomUUID(),
            productId: productA,
            code: `EVIL${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
            purchaserCustomerId: randomUUID(),
            valueCents: 2500,
            currency: "EUR",
          },
        }),
      ),
    ).rejects.toThrow();
    // Nothing landed in B on the way through.
    expect(await asTenant(idB, (tx) => tx.giftCard.count())).toBe(1);
  });

  afterAll(async () => {
    // FK order: cards reference products, customers and venues.
    for (const id of [idA, idB]) {
      await asTenant(id, (tx) => tx.giftCard.deleteMany({}));
      await asTenant(id, (tx) => tx.giftCardProduct.deleteMany({}));
      await asTenant(id, (tx) => tx.customer.deleteMany({}));
      await asTenant(id, (tx) => tx.venue.deleteMany({}));
      await asTenant(id, (tx) => tx.tenant.deleteMany({}));
    }
    await prisma.$disconnect();
  });
});
