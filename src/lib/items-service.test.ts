import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { completeOnboarding, saveStep1, saveStep2, saveStep3 } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import { createCategory } from "./categories-service";
import { createItem, listItems, softDeleteItem, updateItem } from "./items-service";

describe("items service", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  async function onboardedUserWithCategory(): Promise<{
    userId: string;
    tenantId: string;
    categoryId: string;
  }> {
    const email = `p1-6-${randomUUID()}@ex.com`;
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
    const cat = await createCategory(signup.userId, { name: "Mains" });
    if (!cat.ok) throw new Error("category create failed");
    return { userId: signup.userId, tenantId: signup.tenantId, categoryId: cat.value.id };
  }

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.itemVariant.deleteMany({}));
      await asTenant(tid, (tx) => tx.item.deleteMany({}));
      await asTenant(tid, (tx) => tx.category.deleteMany({}));
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

  it("creates an item with 3 allergens + 2 variants, edits it, soft-deletes it", async () => {
    const { userId, categoryId } = await onboardedUserWithCategory();

    const created = await createItem(userId, {
      categoryId,
      name: "Wild mushroom risotto",
      description: "aged parmesan, thyme",
      priceCents: 1800,
      allergens: ["gluten", "milk", "sulphites"],
      dietary: ["vegetarian"],
      spice: 0,
      isAvailable: true,
      variants: [
        { name: "Regular", priceDeltaCents: 0 },
        { name: "Truffle", priceDeltaCents: 500 },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.allergens).toEqual(["gluten", "milk", "sulphites"]);
    expect(created.value.variants).toHaveLength(2);
    expect(created.value.variants.map((v) => v.name)).toEqual(["Regular", "Truffle"]);

    // Edit — name and price change; allergens stay.
    const edited = await updateItem(userId, created.value.id, {
      name: "Truffle mushroom risotto",
      priceCents: 2200,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.name).toBe("Truffle mushroom risotto");
    expect(edited.value.priceCents).toBe(2200);
    expect(edited.value.allergens).toEqual(["gluten", "milk", "sulphites"]);

    // Soft-delete — row stays in DB, but list omits it.
    expect((await softDeleteItem(userId, created.value.id)).ok).toBe(true);
    const list = await listItems(userId, categoryId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(0);

    // The underlying row is still present with deletedAt set — proves
    // soft-delete rather than hard delete.
    const stillThere = await asUser(userId, (tx) =>
      tx.item.findUnique({ where: { id: created.value.id } }),
    );
    expect(stillThere?.deletedAt).not.toBeNull();
  });

  it("RLS blocks another tenant from editing our item", async () => {
    const a = await onboardedUserWithCategory();
    const b = await onboardedUserWithCategory();

    const created = await createItem(a.userId, {
      categoryId: a.categoryId,
      name: "Only A's",
      priceCents: 100,
      variants: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // User B tries to update A's item by guessing the id. The RLS-scoped
    // find inside updateItem cannot see the row → not_found, and even a
    // raw `tx.item.update` under B's tenant GUC would fail on WITH CHECK.
    const attempt = await updateItem(b.userId, created.value.id, { name: "hijacked" });
    expect(attempt.ok).toBe(false);

    // A's item is unchanged.
    const list = await listItems(a.userId, a.categoryId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value[0]!.name).toBe("Only A's");
  });

  it("list returns items ordered by orderIndex, excludes soft-deleted", async () => {
    const { userId, categoryId } = await onboardedUserWithCategory();

    const a = await createItem(userId, { categoryId, name: "A", priceCents: 100, variants: [] });
    const b = await createItem(userId, { categoryId, name: "B", priceCents: 200, variants: [] });
    const c = await createItem(userId, { categoryId, name: "C", priceCents: 300, variants: [] });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;

    await softDeleteItem(userId, b.value.id);

    const list = await listItems(userId, categoryId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((x) => x.name)).toEqual(["A", "C"]);
  });
});
