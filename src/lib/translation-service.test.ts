import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { completeOnboarding, saveStep1, saveStep2, saveStep3 } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import { createCategory } from "./categories-service";
import { createItem } from "./items-service";
import { getTranslationsForCategory, saveCategoryTranslations } from "./translation-service";

describe("translation service", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  interface Seeded {
    userId: string;
    tenantId: string;
    categoryId: string;
    itemId: string;
  }

  /** Onboarded tenant with one category, one item, and `es` enabled on
   *  top of the `en` + `de` onboarding provisions. */
  async function seed(): Promise<Seeded> {
    const email = `translations-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Placeholder",
    });
    if (!signup.ok) throw new Error("signup failed");
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    await saveStep1(signup.userId, { venueName: "Test Venue" });
    await saveStep2(signup.userId, { importBranch: "manual" });
    await saveStep3(signup.userId, { primaryColor: "#1f3b2e" });
    if (!(await completeOnboarding(signup.userId)).ok) throw new Error("onboarding failed");
    await asUser(signup.userId, (tx) =>
      tx.venue.updateMany({ data: { enabledLocales: ["en", "de", "es"] } }),
    );

    const cat = await createCategory(signup.userId, { name: "Mains" });
    if (!cat.ok) throw new Error("category create failed");
    const item = await createItem(signup.userId, {
      categoryId: cat.value.id,
      name: "Wild mushroom risotto",
      description: "aged parmesan, thyme",
      priceCents: 1800,
      variants: [],
    });
    if (!item.ok) throw new Error("item create failed");
    return {
      userId: signup.userId,
      tenantId: signup.tenantId,
      categoryId: cat.value.id,
      itemId: item.value.id,
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

  it("reads the empty state: default text, no translations, default locale excluded", async () => {
    const { userId, categoryId, itemId } = await seed();
    const read = await getTranslationsForCategory(userId, categoryId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.value.locales).toEqual({
      default: "en",
      enabled: ["en", "de", "es"],
      translatable: ["de", "es"],
    });
    expect(read.value.category.name).toEqual({ base: "Mains", byLocale: {} });
    expect(read.value.items).toHaveLength(1);
    expect(read.value.items[0]!.id).toBe(itemId);
    expect(read.value.items[0]!.name.base).toBe("Wild mushroom risotto");
    expect(read.value.items[0]!.description.base).toBe("aged parmesan, thyme");
  });

  it("saves category + item translations for two locales and reads them back", async () => {
    const { userId, categoryId, itemId } = await seed();

    const save = await saveCategoryTranslations(userId, categoryId, {
      category: { de: "Hauptgerichte", es: "Principales" },
      items: [
        {
          id: itemId,
          name: { de: "Steinpilzrisotto", es: "Risotto de setas" },
          description: { es: "parmesano curado, tomillo" },
        },
      ],
    });
    expect(save.ok).toBe(true);
    if (!save.ok) return;
    expect(save.value).toEqual({ saved: 5, removed: 0 });

    const read = await getTranslationsForCategory(userId, categoryId);
    if (!read.ok) throw new Error("read failed");
    expect(read.value.category.name.byLocale).toEqual({
      de: "Hauptgerichte",
      es: "Principales",
    });
    expect(read.value.items[0]!.name.byLocale).toEqual({
      de: "Steinpilzrisotto",
      es: "Risotto de setas",
    });
    // No German description was typed — the overlay falls back to the base.
    expect(read.value.items[0]!.description.byLocale).toEqual({
      es: "parmesano curado, tomillo",
    });
  });

  it("re-saving only writes what changed", async () => {
    const { userId, categoryId, itemId } = await seed();
    await saveCategoryTranslations(userId, categoryId, {
      category: { de: "Hauptgerichte" },
      items: [{ id: itemId, name: { de: "Steinpilzrisotto" } }],
    });

    const again = await saveCategoryTranslations(userId, categoryId, {
      category: { de: "Hauptgerichte" },
      items: [{ id: itemId, name: { de: "Pilzrisotto" } }],
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value).toEqual({ saved: 1, removed: 0 });
  });

  it("clearing a field deletes the row so the guest falls back to the base text", async () => {
    const { userId, categoryId, itemId } = await seed();
    await saveCategoryTranslations(userId, categoryId, {
      category: { de: "Hauptgerichte" },
      items: [{ id: itemId, name: { de: "Steinpilzrisotto" } }],
    });

    const cleared = await saveCategoryTranslations(userId, categoryId, {
      category: { de: "   " },
      items: [{ id: itemId, name: { de: "" } }],
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value).toEqual({ saved: 0, removed: 2 });

    const rows = await asUser(userId, (tx) => tx.translation.findMany({}));
    expect(rows).toHaveLength(0);
  });

  it("rejects a locale the venue has not enabled, and the default locale", async () => {
    const { userId, categoryId, itemId } = await seed();

    const notEnabled = await saveCategoryTranslations(userId, categoryId, {
      category: { fr: "Plats principaux" },
    });
    expect(notEnabled).toEqual({ ok: false, error: "invalid" });

    // `en` IS enabled, but it is the default — that text lives on the
    // Category/Item row, not in an overlay.
    const defaultLocale = await saveCategoryTranslations(userId, categoryId, {
      items: [{ id: itemId, name: { en: "Overridden" } }],
    });
    expect(defaultLocale).toEqual({ ok: false, error: "invalid" });

    // Not a locale at all — zod refuses before the transaction opens.
    const nonsense = await saveCategoryTranslations(userId, categoryId, {
      category: { xx: "nope" },
    });
    expect(nonsense).toEqual({ ok: false, error: "invalid" });

    const rows = await asUser(userId, (tx) => tx.translation.findMany({}));
    expect(rows).toHaveLength(0);
  });

  it("rejects an item id from another category and from another tenant", async () => {
    const mine = await seed();
    const otherTenant = await seed();

    const foreignCategory = await createCategory(mine.userId, { name: "Desserts" });
    if (!foreignCategory.ok) throw new Error("category create failed");
    const dessert = await createItem(mine.userId, {
      categoryId: foreignCategory.value.id,
      name: "Tiramisu",
      priceCents: 700,
      variants: [],
    });
    if (!dessert.ok) throw new Error("item create failed");

    const wrongCategory = await saveCategoryTranslations(mine.userId, mine.categoryId, {
      items: [{ id: dessert.value.id, name: { de: "Tiramisu" } }],
    });
    expect(wrongCategory).toEqual({ ok: false, error: "not_found" });

    const crossTenant = await saveCategoryTranslations(mine.userId, mine.categoryId, {
      items: [{ id: otherTenant.itemId, name: { de: "Fremd" } }],
    });
    expect(crossTenant).toEqual({ ok: false, error: "not_found" });

    const rows = await asUser(mine.userId, (tx) => tx.translation.findMany({}));
    expect(rows).toHaveLength(0);
  });

  it("refuses to read or write another tenant's category (RLS)", async () => {
    const mine = await seed();
    const theirs = await seed();

    expect(await getTranslationsForCategory(mine.userId, theirs.categoryId)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await saveCategoryTranslations(mine.userId, theirs.categoryId, {
        category: { de: "Hauptgerichte" },
      }),
    ).toEqual({ ok: false, error: "not_found" });

    const rows = await asUser(theirs.userId, (tx) => tx.translation.findMany({}));
    expect(rows).toHaveLength(0);
  });
});
