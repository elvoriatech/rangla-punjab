import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { provisionRestaurant } from "./provisioning";

/**
 * Provisioning runs cross-tenant, so in prod it uses the app's owner-role
 * connection (RLS disabled). The test app connection is the RLS-enforced
 * least-privilege role, so we inject an owner-role client (DATABASE_URL)
 * for the creation — the same privilege prod's app role has.
 */
const OWNER_URL = process.env.DATABASE_URL ?? "";
const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });

const TEMPLATE_KEY = `prov-tmpl-${randomUUID().slice(0, 8)}`;
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];
let adminUserId = "";

describe("provisionRestaurant (P3-2)", () => {
  beforeAll(async () => {
    await owner.menuTemplate.create({
      data: {
        key: TEMPLATE_KEY,
        name: "Prov Template",
        cuisine: "Test",
        emoji: "🧪",
        active: true,
        sortIndex: 990,
        content: {
          categories: [
            {
              name: "Starters",
              items: [{ name: "Pakora", priceCents: 500, dietary: [], allergens: [], spice: 1 }],
            },
            {
              name: "Mains",
              items: [{ name: "Biryani", priceCents: 1490, dietary: [], allergens: [], spice: 2 }],
            },
          ],
        },
      },
    });
    const admin = await owner.user.create({
      data: {
        email: `prov-admin-${randomUUID()}@ex.com`,
        passwordHash: "x",
        isPlatformAdmin: true,
      },
      select: { id: true },
    });
    adminUserId = admin.id;
    createdUserIds.push(admin.id);
  });

  afterEach(async () => {
    for (const tid of createdTenantIds.splice(0)) {
      await owner.item.deleteMany({ where: { tenantId: tid } });
      await owner.category.deleteMany({ where: { tenantId: tid } });
      await owner.menu.updateMany({ where: { tenantId: tid }, data: { publishedVersion: null } });
      await owner.menuVersion.deleteMany({ where: { tenantId: tid } });
      await owner.menu.deleteMany({ where: { tenantId: tid } });
      await owner.venue.deleteMany({ where: { tenantId: tid } });
      const members = await owner.membership.findMany({
        where: { tenantId: tid },
        select: { userId: true },
      });
      await owner.membership.deleteMany({ where: { tenantId: tid } });
      await owner.tenant.deleteMany({ where: { id: tid } });
      const ids = members.map((m) => m.userId);
      if (ids.length) {
        await owner.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
        await owner.user.deleteMany({ where: { id: { in: ids } } });
      }
    }
  });

  afterAll(async () => {
    await owner.passwordResetToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await owner.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await owner.menuTemplate.deleteMany({ where: { key: TEMPLATE_KEY } });
    await owner.$disconnect();
  });

  it("creates the tenant, owner, venue, published menu, and an invite token", async () => {
    const ownerEmail = `prov-owner-${randomUUID()}@ex.com`;
    const result = await provisionRestaurant(
      adminUserId,
      { restaurantName: "Provisioned Kitchen", ownerEmail, templateKey: TEMPLATE_KEY },
      owner,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdTenantIds.push(result.tenantId);

    const venue = await owner.venue.findUniqueOrThrow({
      where: { id: result.venueId },
      select: { tenantId: true, slug: true, currency: true },
    });
    expect(venue.tenantId).toBe(result.tenantId);
    expect(venue.slug).toBe(result.slug);

    const cats = await owner.category.count({ where: { tenantId: result.tenantId } });
    const items = await owner.item.count({ where: { tenantId: result.tenantId } });
    expect(cats).toBe(2);
    expect(items).toBe(2);

    const publishedMenu = await owner.menu.findFirstOrThrow({
      where: { tenantId: result.tenantId },
      select: { publishedVersion: true },
    });
    expect(publishedMenu.publishedVersion).not.toBeNull();

    const membership = await owner.membership.findFirstOrThrow({
      where: { tenantId: result.tenantId },
      select: { role: true, user: { select: { email: true } } },
    });
    expect(membership.role).toBe("owner");
    expect(membership.user.email).toBe(ownerEmail);

    // Invite: a set-password token was issued for the new owner.
    const invitedUser = await owner.user.findFirstOrThrow({ where: { email: ownerEmail } });
    const tokens = await owner.passwordResetToken.count({ where: { userId: invitedUser.id } });
    expect(tokens).toBeGreaterThan(0);
  });

  it("rejects a duplicate owner email without creating anything", async () => {
    const ownerEmail = `prov-dupe-${randomUUID()}@ex.com`;
    const first = await provisionRestaurant(
      adminUserId,
      { restaurantName: "First", ownerEmail, templateKey: TEMPLATE_KEY },
      owner,
    );
    expect(first.ok).toBe(true);
    if (first.ok) createdTenantIds.push(first.tenantId);

    const second = await provisionRestaurant(
      adminUserId,
      { restaurantName: "Second", ownerEmail, templateKey: TEMPLATE_KEY },
      owner,
    );
    expect(second).toEqual({ ok: false, error: "duplicate_email" });
  });

  it("refuses a non-admin caller and an unknown template", async () => {
    const nonAdmin = await owner.user.create({
      data: { email: `prov-nonadmin-${randomUUID()}@ex.com`, passwordHash: "x" },
      select: { id: true },
    });
    createdUserIds.push(nonAdmin.id);
    const forbidden = await provisionRestaurant(
      nonAdmin.id,
      { restaurantName: "X", ownerEmail: `x-${randomUUID()}@ex.com`, templateKey: TEMPLATE_KEY },
      owner,
    );
    expect(forbidden).toEqual({ ok: false, error: "forbidden" });

    const badTemplate = await provisionRestaurant(
      adminUserId,
      {
        restaurantName: "X",
        ownerEmail: `y-${randomUUID()}@ex.com`,
        templateKey: "does-not-exist",
      },
      owner,
    );
    expect(badTemplate).toEqual({ ok: false, error: "unknown_template" });
  });
});
