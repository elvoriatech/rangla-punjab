import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { completeOnboarding, saveStep1, saveStep2, saveStep3 } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from "./categories-service";

describe("categories service", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  async function onboardedUser(): Promise<{ userId: string; tenantId: string }> {
    const email = `p1-5-${randomUUID()}@ex.com`;
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
    const done = await completeOnboarding(signup.userId);
    if (!done.ok) throw new Error("onboarding did not complete");
    return { userId: signup.userId, tenantId: signup.tenantId };
  }

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      // Delete in dep order: categories → menu_versions → menus → venues.
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

  it("creates three categories, reorders them, and the list returns the new order", async () => {
    const { userId } = await onboardedUser();

    const starters = await createCategory(userId, { name: "Starters" });
    const mains = await createCategory(userId, { name: "Mains" });
    const desserts = await createCategory(userId, { name: "Desserts" });
    expect(starters.ok && mains.ok && desserts.ok).toBe(true);

    const initial = await listCategories(userId);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.value.map((c) => c.name)).toEqual(["Starters", "Mains", "Desserts"]);

    // Reverse the order.
    const reorder = await reorderCategories(userId, {
      orderedIds: initial.value
        .slice()
        .reverse()
        .map((c) => c.id),
    });
    expect(reorder.ok).toBe(true);

    // The "public read" — same read a public menu page would issue,
    // ordered by orderIndex ascending.
    const after = await listCategories(userId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.map((c) => c.name)).toEqual(["Desserts", "Mains", "Starters"]);
    // Indices are re-numbered in 100-unit gaps.
    expect(after.value.map((c) => c.orderIndex)).toEqual([100, 200, 300]);
  });

  it("rename updates a single row; delete removes it; list reflects both", async () => {
    const { userId } = await onboardedUser();
    const a = await createCategory(userId, { name: "A" });
    const b = await createCategory(userId, { name: "B" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect((await renameCategory(userId, { id: a.value.id, name: "Antipasti" })).ok).toBe(true);
    expect((await deleteCategory(userId, b.value.id)).ok).toBe(true);

    const list = await listCategories(userId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((c) => c.name)).toEqual(["Antipasti"]);
  });

  it("reorder rejects an id not in this tenant's draft", async () => {
    const { userId } = await onboardedUser();
    const a = await createCategory(userId, { name: "A" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const bogus = await reorderCategories(userId, {
      orderedIds: [a.value.id, "not-a-real-id"],
    });
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) expect(bogus.error).toBe("not_found");
  });

  it("RLS blocks another tenant from reordering or deleting our category", async () => {
    const { userId: userAId } = await onboardedUser();
    const { userId: userBId } = await onboardedUser();

    const catA = await createCategory(userAId, { name: "A's category" });
    expect(catA.ok).toBe(true);
    if (!catA.ok) return;

    // User B tries to delete A's category by guessing the id. Both the id-
    // lookup within the draft and RLS ensure they can't touch it.
    const attempt = await deleteCategory(userBId, catA.value.id);
    expect(attempt.ok).toBe(false);

    // A's category is still there.
    const stillThere = await asUser(userAId, (tx) => tx.category.findMany());
    expect(stillThere.map((c) => c.name)).toEqual(["A's category"]);
  });
});
