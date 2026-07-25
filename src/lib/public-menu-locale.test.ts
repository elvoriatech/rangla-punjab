import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { completeOnboarding, saveStep1, saveStep2, saveStep3 } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import { createCategory } from "./categories-service";
import { createItem } from "./items-service";
import { publishDraft } from "./menu-versions-service";
import { resolvePreviewContext } from "./preview-context";
import { loadPublicMenu } from "./public-menu";

describe("public menu — locale overlay", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  interface Seeded {
    userId: string;
    tenantId: string;
    venueSlug: string;
    itemId: string;
    categoryId: string;
  }

  async function seedWithTranslations(): Promise<Seeded> {
    const email = `p1-11-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Placeholder",
    });
    if (!signup.ok) throw new Error("signup failed");
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    await saveStep1(signup.userId, { venueName: "Ristorante Volpe" });
    await saveStep2(signup.userId, { importBranch: "manual" });
    await saveStep3(signup.userId, { primaryColor: "#1f3b2e" });
    if (!(await completeOnboarding(signup.userId)).ok) throw new Error("onboarding failed");

    const cat = await createCategory(signup.userId, { name: "Mains" });
    if (!cat.ok) throw new Error("category failed");
    const item = await createItem(signup.userId, {
      categoryId: cat.value.id,
      name: "Wild mushroom risotto",
      description: "aged parmesan, thyme",
      priceCents: 1800,
      variants: [],
    });
    if (!item.ok) throw new Error("item failed");

    // Seed German translations for the category + item's name and description.
    await asUser(signup.userId, async (tx) => {
      await tx.translation.createMany({
        data: [
          {
            tenantId: signup.tenantId,
            entityType: "category",
            entityId: cat.value.id,
            locale: "de",
            field: "name",
            value: "Hauptgerichte",
          },
          {
            tenantId: signup.tenantId,
            entityType: "item",
            entityId: item.value.id,
            locale: "de",
            field: "name",
            value: "Steinpilzrisotto",
          },
          {
            tenantId: signup.tenantId,
            entityType: "item",
            entityId: item.value.id,
            locale: "de",
            field: "description",
            value: "gereifter Parmesan, Thymian",
          },
        ],
      });
    });

    const publish = await publishDraft(signup.userId);
    if (!publish.ok) throw new Error("publish failed");

    // Also copy the translations onto the *published* category/item ids —
    // publishing snapshots content but not translation rows in P1-7, so we
    // re-emit them for the published tree here to keep the test honest.
    // (A future task can fold translations into the publish snapshot.)
    const publishedCat = await asUser(signup.userId, (tx) =>
      tx.category.findFirstOrThrow({
        where: { menuVersionId: publish.publishedVersionId },
        include: { items: true },
      }),
    );
    const publishedItem = publishedCat.items[0]!;
    await asUser(signup.userId, async (tx) => {
      await tx.translation.createMany({
        data: [
          {
            tenantId: signup.tenantId,
            entityType: "category",
            entityId: publishedCat.id,
            locale: "de",
            field: "name",
            value: "Hauptgerichte",
          },
          {
            tenantId: signup.tenantId,
            entityType: "item",
            entityId: publishedItem.id,
            locale: "de",
            field: "name",
            value: "Steinpilzrisotto",
          },
          {
            tenantId: signup.tenantId,
            entityType: "item",
            entityId: publishedItem.id,
            locale: "de",
            field: "description",
            value: "gereifter Parmesan, Thymian",
          },
        ],
      });
    });

    const venue = await asUser(signup.userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { slug: true } }),
    );
    return {
      userId: signup.userId,
      tenantId: signup.tenantId,
      venueSlug: venue.slug,
      itemId: item.value.id,
      categoryId: cat.value.id,
    };
  }

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.translation.deleteMany({}));
      await asTenant(tid, (tx) => tx.itemVariant.deleteMany({}));
      await asTenant(tid, (tx) => tx.item.deleteMany({}));
      await asTenant(tid, (tx) => tx.category.deleteMany({}));
      await asTenant(tid, (tx) => tx.menu.updateMany({ data: { publishedVersion: null } }));
      await asTenant(tid, (tx) => tx.menuVersion.deleteMany({}));
      await asTenant(tid, (tx) => tx.menu.deleteMany({}));
      await asTenant(tid, (tx) => tx.venue.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  it("returns default text when no locale is requested (defaultLocale = en)", async () => {
    const { venueSlug } = await seedWithTranslations();
    const ctx = await resolvePreviewContext(venueSlug, null);
    const menu = await loadPublicMenu(ctx!);
    expect(menu?.locale).toBe("en");
    expect(menu?.categories[0]!.name).toBe("Mains");
    expect(menu?.categories[0]!.items[0]!.name).toBe("Wild mushroom risotto");
  });

  it("applies the German translation when locale=de is requested", async () => {
    const { venueSlug } = await seedWithTranslations();
    const ctx = await resolvePreviewContext(venueSlug, null);
    const menu = await loadPublicMenu(ctx!, "de");
    expect(menu?.locale).toBe("de");
    expect(menu?.categories[0]!.name).toBe("Hauptgerichte");
    expect(menu?.categories[0]!.items[0]!.name).toBe("Steinpilzrisotto");
    expect(menu?.categories[0]!.items[0]!.description).toBe("gereifter Parmesan, Thymian");
  });

  it("falls back to the default text for fields with no translation row", async () => {
    const { venueSlug } = await seedWithTranslations();
    // Request `fr` — no translations exist for that locale at all. Every
    // field falls back to the base row's value.
    const ctx = await resolvePreviewContext(venueSlug, null);
    const menu = await loadPublicMenu(ctx!, "fr");
    expect(menu?.locale).toBe("fr");
    expect(menu?.categories[0]!.name).toBe("Mains");
    expect(menu?.categories[0]!.items[0]!.name).toBe("Wild mushroom risotto");
  });

  it("onboarding provisions `en` + `de` in enabledLocales by default", async () => {
    const { venueSlug } = await seedWithTranslations();
    const ctx = await resolvePreviewContext(venueSlug, null);
    const menu = await loadPublicMenu(ctx!);
    expect(menu?.venue.enabledLocales).toEqual(["en", "de"]);
  });
});
