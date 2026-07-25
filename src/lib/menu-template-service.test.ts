import { randomUUID } from "node:crypto";
import { readUpload, writeUpload } from "./image-storage";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant } from "./tenant";
import { applyTemplateToDraft, listActiveTemplates } from "./menu-template-service";

describe("menu templates", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];
  const createdTemplateKeys: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdTemplateKeys.length) {
      await prisma.menuTemplate.deleteMany({ where: { key: { in: createdTemplateKeys } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
    createdTemplateKeys.length = 0;
  });

  async function tenantWithDraft(): Promise<{ userId: string; tenantId: string; venueId: string }> {
    const s = await signupUser({
      email: `tpl-${randomUUID()}@ex.com`,
      password: "S3cureP4ssPhrase!",
      tenantName: "Template Test",
    });
    if (!s.ok) throw new Error("signup failed");
    createdUserIds.push(s.userId);
    createdTenantIds.push(s.tenantId);
    const venueId = await asTenant(s.tenantId, async (tx) => {
      const venue = await tx.venue.create({
        data: {
          tenantId: s.tenantId,
          name: "Template Test Venue",
          slug: `tpl-${randomUUID().slice(0, 8)}`,
          currency: "CHF",
        },
        select: { id: true },
      });
      const menu = await tx.menu.create({
        data: { tenantId: s.tenantId, venueId: venue.id, name: "Main", isDefault: true },
        select: { id: true },
      });
      await tx.menuVersion.create({
        data: { tenantId: s.tenantId, menuId: menu.id, status: "draft" },
      });
      return venue.id;
    });
    return { userId: s.userId, tenantId: s.tenantId, venueId };
  }

  async function makeTemplate(): Promise<string> {
    const key = `test-${randomUUID().slice(0, 8)}`;
    createdTemplateKeys.push(key);
    await prisma.menuTemplate.create({
      data: {
        key,
        name: "Test Cuisine",
        cuisine: "Test",
        emoji: "🧪",
        sortIndex: 999,
        active: true,
        content: {
          categories: [
            {
              name: "Starters",
              items: [
                { name: "Soup", priceCents: 500, dietary: ["vegan"], allergens: [], spice: 0 },
                {
                  name: "Salad",
                  priceCents: 700,
                  dietary: ["vegetarian"],
                  allergens: ["milk"],
                  spice: 0,
                },
              ],
            },
            {
              name: "Mains",
              items: [
                {
                  name: "Curry",
                  description: "Spicy",
                  priceCents: 1200,
                  dietary: [],
                  allergens: [],
                  spice: 3,
                },
              ],
            },
          ],
        },
      },
    });
    return key;
  }

  it("lists only active templates for the picker", async () => {
    const key = await makeTemplate();
    const active = await listActiveTemplates();
    const mine = active.find((t) => t.key === key);
    expect(mine).toMatchObject({ categoryCount: 2, itemCount: 3, emoji: "🧪" });
    await prisma.menuTemplate.updateMany({ where: { key }, data: { active: false } });
    expect((await listActiveTemplates()).find((t) => t.key === key)).toBeUndefined();
  });

  it("clones a template into the draft with the venue's currency", async () => {
    const fx = await tenantWithDraft();
    const key = await makeTemplate();
    const result = await applyTemplateToDraft(fx.userId, key);
    expect(result).toEqual({ ok: true, categoriesCreated: 2, itemsCreated: 3 });

    const rows = await asTenant(fx.tenantId, (tx) =>
      tx.item.findMany({
        where: { deletedAt: null },
        select: { name: true, currency: true, priceCents: true, spice: true, dietary: true },
        orderBy: { priceCents: "asc" },
      }),
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.currency === "CHF")).toBe(true); // venue currency, not template
    expect(rows.find((r) => r.name === "Curry")?.spice).toBe(3);
    expect(rows.find((r) => r.name === "Soup")?.dietary).toEqual(["vegan"]);
  });

  it("REPLACES the draft (a second apply doesn't stack)", async () => {
    const fx = await tenantWithDraft();
    const key = await makeTemplate();
    await applyTemplateToDraft(fx.userId, key);
    await applyTemplateToDraft(fx.userId, key);
    const count = await asTenant(fx.tenantId, (tx) =>
      tx.item.count({ where: { deletedAt: null } }),
    );
    expect(count).toBe(3); // not 6
  });

  it("clones template photos into tenant-owned media (copied object, not shared)", async () => {
    const fx = await tenantWithDraft();
    const key = `test-${randomUUID().slice(0, 8)}`;
    createdTemplateKeys.push(key);

    // A platform-owned template photo living under templates/ on disk.
    const templateImageKey = `templates/test-${randomUUID()}`;
    await writeUpload(templateImageKey, Buffer.from("fake-image-bytes"));

    await prisma.menuTemplate.create({
      data: {
        key,
        name: "Imaged",
        cuisine: "Test",
        emoji: "🧪",
        sortIndex: 999,
        active: true,
        content: {
          categories: [
            {
              name: "Mains",
              image: { key: templateImageKey, width: 640, height: 480, bytes: 16 },
              items: [
                {
                  name: "Curry",
                  priceCents: 1200,
                  dietary: [],
                  allergens: [],
                  spice: 0,
                  image: { key: templateImageKey, width: 640, height: 480, bytes: 16 },
                },
              ],
            },
          ],
        },
      },
    });

    const result = await applyTemplateToDraft(fx.userId, key);
    expect(result).toEqual({ ok: true, categoriesCreated: 1, itemsCreated: 1 });

    const { itemMedia, categoryMedia } = await asTenant(fx.tenantId, async (tx) => {
      const item = await tx.item.findFirstOrThrow({
        where: { name: "Curry" },
        select: { photoMedia: { select: { storageKey: true, width: true, tenantId: true } } },
      });
      const category = await tx.category.findFirstOrThrow({
        where: { name: "Mains" },
        select: { photoMedia: { select: { storageKey: true } } },
      });
      return { itemMedia: item.photoMedia, categoryMedia: category.photoMedia };
    });

    // Tenant-owned Media rows pointing at the tenant's own prefix — not
    // the shared template object.
    expect(itemMedia?.tenantId).toBe(fx.tenantId);
    expect(itemMedia?.width).toBe(640);
    expect(itemMedia?.storageKey).toMatch(new RegExp(`^${fx.tenantId}/uploads/`));
    expect(itemMedia?.storageKey).not.toBe(templateImageKey);
    expect(categoryMedia?.storageKey).toMatch(new RegExp(`^${fx.tenantId}/uploads/`));

    // The copied object actually exists on disk with the template's bytes.
    const copied = await readUpload(itemMedia!.storageKey);
    expect(copied?.toString()).toBe("fake-image-bytes");
  });

  it("rejects an unknown template", async () => {
    const fx = await tenantWithDraft();
    expect(await applyTemplateToDraft(fx.userId, "does-not-exist")).toEqual({
      ok: false,
      error: "unknown_template",
    });
  });
});
