import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { completeOnboarding, saveStep1, saveStep2, saveStep3 } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import { createCategory, renameCategory } from "./categories-service";
import { createItem, updateItem } from "./items-service";
import { ensureDraft, getMenuStatus, publishDraft } from "./menu-versions-service";
import { resolvePreviewContext } from "./preview-context";
import { loadPublicMenu } from "./public-menu";

describe("draft/publish workflow", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  async function onboardedUserWithMenu(): Promise<{
    userId: string;
    tenantId: string;
    categoryId: string;
  }> {
    const email = `p1-7-${randomUUID()}@ex.com`;
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
    if (!cat.ok) throw new Error("category failed");
    return { userId: signup.userId, tenantId: signup.tenantId, categoryId: cat.value.id };
  }

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.translation.deleteMany({}));
      await asTenant(tid, (tx) => tx.itemVariant.deleteMany({}));
      await asTenant(tid, (tx) => tx.item.deleteMany({}));
      await asTenant(tid, (tx) => tx.category.deleteMany({}));
      // Clear the published pointer before deleting versions, otherwise
      // Prisma keeps the FK-target row alive.
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

  it("publish snapshots the draft into a new version and stamps published_at", async () => {
    const { userId, categoryId } = await onboardedUserWithMenu();
    await createItem(userId, { categoryId, name: "Risotto", priceCents: 1800, variants: [] });

    const before = await getMenuStatus(userId);
    expect(before.publishedVersionId).toBeNull();

    const publish = await publishDraft(userId);
    expect(publish.ok).toBe(true);
    if (!publish.ok) return;

    const after = await getMenuStatus(userId);
    expect(after.publishedVersionId).toBe(publish.publishedVersionId);
    expect(after.publishedAt).toBeInstanceOf(Date);

    // The new version has its own copy of the category + item.
    const publishedCats = await asUser(userId, (tx) =>
      tx.category.findMany({ where: { menuVersionId: publish.publishedVersionId } }),
    );
    expect(publishedCats).toHaveLength(1);
    expect(publishedCats[0]!.name).toBe("Mains");
    const publishedItems = await asUser(userId, (tx) =>
      tx.item.findMany({ where: { categoryId: publishedCats[0]!.id } }),
    );
    expect(publishedItems).toHaveLength(1);
    expect(publishedItems[0]!.name).toBe("Risotto");
  });

  it("editing after publish leaves the published version unchanged until re-publish", async () => {
    const { userId, categoryId } = await onboardedUserWithMenu();
    await createItem(userId, { categoryId, name: "Risotto", priceCents: 1800, variants: [] });

    const first = await publishDraft(userId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Edit the DRAFT category — this must not touch the published version.
    const rename = await renameCategory(userId, { id: categoryId, name: "Primi Piatti" });
    expect(rename.ok).toBe(true);

    const publishedCatBefore = await asUser(userId, (tx) =>
      tx.category.findFirst({ where: { menuVersionId: first.publishedVersionId } }),
    );
    expect(publishedCatBefore?.name).toBe("Mains"); // still the old name

    // Now re-publish; the new published version reflects the edit.
    const second = await publishDraft(userId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.publishedVersionId).not.toBe(first.publishedVersionId);

    const publishedCatAfter = await asUser(userId, (tx) =>
      tx.category.findFirst({ where: { menuVersionId: second.publishedVersionId } }),
    );
    expect(publishedCatAfter?.name).toBe("Primi Piatti");

    // Menu.publishedVersion now points at the newer one.
    const status = await getMenuStatus(userId);
    expect(status.publishedVersionId).toBe(second.publishedVersionId);
  });

  it("publish refuses an empty draft", async () => {
    const { userId } = await onboardedUserWithMenu();
    // Delete the placeholder category so the draft has zero categories.
    await asUser(userId, (tx) => tx.category.deleteMany({}));
    const publish = await publishDraft(userId);
    expect(publish.ok).toBe(false);
    if (!publish.ok) expect(publish.error).toBe("empty_menu");
  });

  it("publish snapshots variants and allergens verbatim", async () => {
    const { userId, categoryId } = await onboardedUserWithMenu();
    await createItem(userId, {
      categoryId,
      name: "Risotto",
      priceCents: 1800,
      allergens: ["gluten", "milk"],
      dietary: ["vegetarian"],
      variants: [
        { name: "Regular", priceDeltaCents: 0 },
        { name: "Truffle", priceDeltaCents: 500 },
      ],
    });

    const publish = await publishDraft(userId);
    expect(publish.ok).toBe(true);
    if (!publish.ok) return;

    const publishedItem = await asUser(userId, (tx) =>
      tx.item.findFirst({
        where: { category: { menuVersionId: publish.publishedVersionId } },
        include: { variants: { orderBy: { orderIndex: "asc" } } },
      }),
    );
    expect(publishedItem?.allergens).toEqual(["gluten", "milk"]);
    expect(publishedItem?.variants).toHaveLength(2);
    expect(publishedItem?.variants.map((v) => v.name)).toEqual(["Regular", "Truffle"]);
    expect(publishedItem?.variants.map((v) => v.priceDeltaCents)).toEqual([0, 500]);
  });

  it("publish carries dish + category translations onto the snapshot", async () => {
    const { userId, tenantId, categoryId } = await onboardedUserWithMenu();
    const item = await createItem(userId, {
      categoryId,
      name: "Risotto",
      description: "aged parmesan, thyme",
      priceCents: 1800,
      variants: [{ name: "Regular", priceDeltaCents: 0 }],
    });
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    const variantId = item.value.variants[0]!.id;

    await asUser(userId, async (tx) => {
      await tx.venue.updateMany({ data: { enabledLocales: ["en", "de", "es"] } });
      const cat = { entityType: "category", entityId: categoryId };
      const dish = { entityType: "item", entityId: item.value.id };
      await tx.translation.createMany({
        data: [
          { ...cat, locale: "de", field: "name", value: "Hauptgerichte" },
          { ...dish, locale: "de", field: "name", value: "Steinpilzrisotto" },
          { ...cat, locale: "es", field: "name", value: "Principales" },
          { ...dish, locale: "es", field: "name", value: "Risotto de setas" },
          { ...dish, locale: "es", field: "description", value: "parmesano curado, tomillo" },
          {
            entityType: "item_variant",
            entityId: variantId,
            locale: "es",
            field: "name",
            value: "Normal",
          },
        ].map((r) => ({ ...r, tenantId })),
      });
    });

    const publish = await publishDraft(userId);
    expect(publish.ok).toBe(true);
    if (!publish.ok) return;

    // The guest-facing read goes through the PUBLISHED tree, so this only
    // passes if the snapshot got its own translation rows.
    const venue = await asUser(userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { slug: true } }),
    );
    const ctx = await resolvePreviewContext(venue.slug, null);
    const menu = await loadPublicMenu(ctx!, "es");
    expect(menu?.categories[0]!.name).toBe("Principales");
    expect(menu?.categories[0]!.items[0]!.name).toBe("Risotto de setas");

    // Six source rows → six copies, one per new id. Nothing duplicated.
    const copied = await asUser(userId, (tx) =>
      tx.translation.findMany({
        where: { entityId: { notIn: [categoryId, item.value.id, variantId] } },
      }),
    );
    expect(copied).toHaveLength(6);
    expect(copied.filter((r) => r.entityType === "item_variant")).toHaveLength(1);
  });

  it("re-publishing replaces translations with the edited draft's, without duplicating", async () => {
    const { userId, tenantId, categoryId } = await onboardedUserWithMenu();
    const item = await createItem(userId, {
      categoryId,
      name: "Risotto",
      priceCents: 1800,
      variants: [],
    });
    if (!item.ok) return;
    await asUser(userId, (tx) =>
      tx.translation.create({
        data: {
          tenantId,
          entityType: "item",
          entityId: item.value.id,
          locale: "de",
          field: "name",
          value: "Risotto",
        },
      }),
    );

    const first = await publishDraft(userId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Edit the draft's translation, then publish again.
    await updateItem(userId, item.value.id, { name: "Steinpilzrisotto" });
    await asUser(userId, (tx) =>
      tx.translation.updateMany({
        where: { entityId: item.value.id, locale: "de", field: "name" },
        data: { value: "Steinpilzrisotto" },
      }),
    );
    const second = await publishDraft(userId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const secondItem = await asUser(userId, (tx) =>
      tx.item.findFirstOrThrow({
        where: { category: { menuVersionId: second.publishedVersionId } },
      }),
    );
    const rows = await asUser(userId, (tx) =>
      tx.translation.findMany({ where: { entityId: secondItem.id } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("Steinpilzrisotto");

    // Each publish owns its own rows — three entities, three rows total.
    const all = await asUser(userId, (tx) => tx.translation.findMany({}));
    expect(all).toHaveLength(3);
  });

  it("publish links every copy back to its draft row, and a fork re-links the other way", async () => {
    const { userId, categoryId } = await onboardedUserWithMenu();
    const draftItem = await createItem(userId, {
      categoryId,
      name: "Risotto",
      priceCents: 1800,
      variants: [],
    });
    if (!draftItem.ok) return;

    const publish = await publishDraft(userId);
    expect(publish.ok).toBe(true);
    if (!publish.ok) return;

    // Published copy -> draft source. This is the link the restaurant app's
    // live edits walk to reach both halves of a dish.
    const copy = await asUser(userId, (tx) =>
      tx.item.findFirstOrThrow({
        where: { category: { menuVersionId: publish.publishedVersionId } },
        select: { id: true, sourceItemId: true },
      }),
    );
    expect(copy.sourceItemId).toBe(draftItem.value.id);
    expect(copy.id).not.toBe(draftItem.value.id);

    // Now lose the draft — the shape a venue provisioned straight to a
    // published version has — and let `ensureDraft` fork a new one. The
    // published rows must learn the FRESH draft ids, or every later app edit
    // would silently stop mirroring.
    await asUser(userId, (tx) => tx.menuVersion.deleteMany({ where: { status: "draft" } }));
    expect((await ensureDraft(userId)).ok).toBe(true);

    const forked = await asUser(userId, (tx) =>
      tx.item.findFirstOrThrow({
        where: { category: { menuVersion: { status: "draft" } } },
        select: { id: true, sourceItemId: true },
      }),
    );
    expect(forked.sourceItemId).toBeNull();
    expect(forked.id).not.toBe(draftItem.value.id);

    const relinked = await asUser(userId, (tx) =>
      tx.item.findFirstOrThrow({ where: { id: copy.id }, select: { sourceItemId: true } }),
    );
    expect(relinked.sourceItemId).toBe(forked.id);
  });
});
