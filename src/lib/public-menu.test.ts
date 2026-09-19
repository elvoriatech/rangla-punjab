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
import {
  formatPrice,
  loadPublicMenu,
  offerItems,
  resolvePublicCategoryParam,
  OFFERS_CATEGORY_ID,
} from "./public-menu";

describe("public menu loader", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  async function seedPublishedMenu(): Promise<{
    userId: string;
    tenantId: string;
    venueSlug: string;
  }> {
    const email = `p1-10-${randomUUID()}@ex.com`;
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

    const starters = await createCategory(signup.userId, { name: "Starters" });
    const mains = await createCategory(signup.userId, { name: "Mains" });
    if (!starters.ok || !mains.ok) throw new Error("category failed");

    await createItem(signup.userId, {
      categoryId: starters.value.id,
      name: "Burrata",
      priceCents: 1400,
      allergens: ["milk"],
      dietary: ["vegetarian"],
      variants: [],
    });
    await createItem(signup.userId, {
      categoryId: mains.value.id,
      name: "Risotto",
      priceCents: 1800,
      allergens: ["gluten", "milk"],
      dietary: ["vegetarian"],
      variants: [
        { name: "Regular", priceDeltaCents: 0 },
        { name: "Truffle", priceDeltaCents: 500 },
      ],
    });

    const publish = await publishDraft(signup.userId);
    if (!publish.ok) throw new Error("publish failed");

    const venue = await asUser(signup.userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { slug: true } }),
    );
    return { userId: signup.userId, tenantId: signup.tenantId, venueSlug: venue.slug };
  }

  afterEach(async () => {
    for (const tid of createdTenantIds) {
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

  it("loads the published tree in order with variants and badges", async () => {
    const { venueSlug } = await seedPublishedMenu();
    const context = await resolvePreviewContext(venueSlug, null);
    expect(context).not.toBeNull();
    if (!context) return;

    const menu = await loadPublicMenu(context);
    expect(menu).not.toBeNull();
    if (!menu) return;

    expect(menu.venue.name).toBe("Ristorante Volpe");
    expect(menu.venue.branding.primaryColor).toBe("#1f3b2e");
    expect(menu.isPreview).toBe(false);
    expect(menu.categories.map((c) => c.name)).toEqual(["Starters", "Mains"]);

    const risotto = menu.categories[1]!.items[0]!;
    expect(risotto.name).toBe("Risotto");
    expect(risotto.allergens).toEqual(["gluten", "milk"]);
    expect(risotto.dietary).toEqual(["vegetarian"]);
    expect(risotto.variants.map((v) => v.name)).toEqual(["Regular", "Truffle"]);
    expect(risotto.variants.map((v) => v.priceDeltaCents)).toEqual([0, 500]);
  });

  it("counts the items whose offer is live as offerCount (P7-12)", async () => {
    const { userId, venueSlug } = await seedPublishedMenu();
    const firstCtx = await resolvePreviewContext(venueSlug, null);
    expect((await loadPublicMenu(firstCtx!))?.offerCount).toBe(0);

    const draftCat = await asUser(userId, (tx) =>
      tx.category.findFirstOrThrow({
        where: { menuVersion: { status: "draft" } },
        orderBy: { orderIndex: "asc" },
      }),
    );
    // An offer with no window is live the moment it is published…
    const live = await createItem(userId, {
      categoryId: draftCat.id,
      name: "Tiramisu",
      priceCents: 800,
      offerPriceCents: 500,
      variants: [],
    });
    // …one whose date range has already closed never counts.
    const expired = await createItem(userId, {
      categoryId: draftCat.id,
      name: "Panna cotta",
      priceCents: 700,
      offerPriceCents: 400,
      offerStartsAt: new Date("2020-01-01T00:00:00Z"),
      offerEndsAt: new Date("2020-02-01T00:00:00Z"),
      variants: [],
    });
    if (!live.ok || !expired.ok) throw new Error("item failed");
    if (!(await publishDraft(userId)).ok) throw new Error("re-publish failed");

    const menu = await loadPublicMenu((await resolvePreviewContext(venueSlug, null))!);
    expect(menu?.offerCount).toBe(1);
    // …and the same rule drives the Offers destination's item list.
    const discounted = offerItems(menu!);
    expect(discounted.map((i) => i.name)).toEqual(["Tiramisu"]);
    expect(discounted[0]!.priceCents).toBe(500);
    expect(discounted[0]!.offer!.basePriceCents).toBe(800);
  });

  it("carries the venue's Google rating, or null when there is none (P7-14)", async () => {
    const { userId, venueSlug } = await seedPublishedMenu();
    const context = await resolvePreviewContext(venueSlug, null);

    // A venue nobody has given a Place ID shows no rating at all — which
    // is every venue until the owner pastes one into Settings.
    expect((await loadPublicMenu(context!))?.rating ?? null).toBeNull();

    await asUser(userId, (tx) =>
      tx.venue.updateMany({
        data: {
          googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
          googleRating: { rating: 4.6, count: 312, fetchedAt: new Date().toISOString() },
        },
      }),
    );
    expect((await loadPublicMenu(context!))?.rating).toEqual({
      value: 4.6,
      count: 312,
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    });

    // A rating cached against a Place ID the owner has since cleared is
    // not a rating: it was read for a place this venue no longer claims.
    await asUser(userId, (tx) => tx.venue.updateMany({ data: { googlePlaceId: null } }));
    expect((await loadPublicMenu(context!))?.rating ?? null).toBeNull();
  });

  it("falls back to the rating the owner typed in themselves (P7-14)", async () => {
    const { userId, venueSlug } = await seedPublishedMenu();
    const context = await resolvePreviewContext(venueSlug, null);

    // No Place ID and no API key — the deployment this fallback exists
    // for. The number shows; the review link has nowhere to go.
    await asUser(userId, (tx) =>
      tx.venue.updateMany({
        data: {
          googleRatingManual: { rating: 4.7, count: 440, updatedAt: new Date().toISOString() },
        },
      }),
    );
    expect((await loadPublicMenu(context!))?.rating).toEqual({
      value: 4.7,
      count: 440,
      reviewUrl: null,
    });

    // Once a real Place ID and a fetched number arrive, they take over by
    // themselves — nothing for the owner to clean up.
    await asUser(userId, (tx) =>
      tx.venue.updateMany({
        data: {
          googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
          googleRating: { rating: 4.6, count: 312, fetchedAt: new Date().toISOString() },
        },
      }),
    );
    expect((await loadPublicMenu(context!))?.rating).toEqual({
      value: 4.6,
      count: 312,
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
  });

  it("drops the rating line entirely while the owner has it switched off (P7-14)", async () => {
    const { userId, venueSlug } = await seedPublishedMenu();
    const context = await resolvePreviewContext(venueSlug, null);

    await asUser(userId, (tx) =>
      tx.venue.updateMany({
        data: {
          googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
          googleRating: { rating: 4.6, count: 312, fetchedAt: new Date().toISOString() },
          googleRatingEnabled: false,
        },
      }),
    );
    expect((await loadPublicMenu(context!))?.rating ?? null).toBeNull();

    // …and comes straight back, unchanged, when it is switched on again.
    await asUser(userId, (tx) => tx.venue.updateMany({ data: { googleRatingEnabled: true } }));
    expect((await loadPublicMenu(context!))?.rating).toMatchObject({ value: 4.6, count: 312 });
  });

  it("resolves ?cat=offers only while something is on offer", async () => {
    const { userId, venueSlug } = await seedPublishedMenu();
    const plain = await loadPublicMenu((await resolvePreviewContext(venueSlug, null))!);
    // No live offer → a stale link degrades to the whole menu.
    expect(resolvePublicCategoryParam(plain!, "offers")).toBeNull();
    // A real category still resolves by its own slug.
    expect(resolvePublicCategoryParam(plain!, "starters")).toBe(plain!.categories[0]!.id);

    const draftCat = await asUser(userId, (tx) =>
      tx.category.findFirstOrThrow({
        where: { menuVersion: { status: "draft" } },
        orderBy: { orderIndex: "asc" },
      }),
    );
    const live = await createItem(userId, {
      categoryId: draftCat.id,
      name: "Affogato",
      priceCents: 600,
      offerPriceCents: 400,
      variants: [],
    });
    if (!live.ok) throw new Error("item failed");
    if (!(await publishDraft(userId)).ok) throw new Error("re-publish failed");

    const withOffer = await loadPublicMenu((await resolvePreviewContext(venueSlug, null))!);
    expect(resolvePublicCategoryParam(withOffer!, "offers")).toBe(OFFERS_CATEGORY_ID);
  });

  it("returns null when the venue has never published", async () => {
    // Seed an onboarded venue but never publish. `resolvePreviewContext`
    // gives us the public context with `publishedVersionId: null`, and the
    // loader must not try to read against a null version.
    const email = `p1-10-nopub-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Placeholder",
    });
    if (!signup.ok) throw new Error();
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    await saveStep1(signup.userId, { venueName: "V" });
    await saveStep2(signup.userId, { importBranch: "manual" });
    await saveStep3(signup.userId, { primaryColor: "#1f3b2e" });
    await completeOnboarding(signup.userId);
    const venue = await asUser(signup.userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { slug: true } }),
    );

    const context = await resolvePreviewContext(venue.slug, null);
    expect(context?.mode).toBe("public");
    const menu = await loadPublicMenu(context!);
    expect(menu).toBeNull();
  });

  it("preview context loads the DRAFT tree, not the published one", async () => {
    const { userId, venueSlug } = await seedPublishedMenu();
    // Publish once — public and draft trees are equal now. Then edit the
    // draft; the loader in preview mode should reflect the edit, but public
    // mode should not.
    const cats = await asUser(userId, (tx) =>
      tx.category.findMany({
        where: { menuVersion: { status: "draft" } },
        orderBy: { orderIndex: "asc" },
      }),
    );
    await asUser(userId, (tx) =>
      tx.category.update({ where: { id: cats[0]!.id }, data: { name: "Antipasti" } }),
    );

    // Public: still says "Starters" because we didn't re-publish.
    const publicCtx = await resolvePreviewContext(venueSlug, null);
    const publicMenu = await loadPublicMenu(publicCtx!);
    expect(publicMenu?.categories[0]!.name).toBe("Starters");

    // Preview: sees the edit.
    const { signPreviewToken } = await import("./preview-token");
    const venue = await asUser(userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { id: true, tenantId: true } }),
    );
    const token = signPreviewToken(venue.tenantId, venue.id);
    const previewCtx = await resolvePreviewContext(venueSlug, token);
    const previewMenu = await loadPublicMenu(previewCtx!);
    expect(previewMenu?.categories[0]!.name).toBe("Antipasti");
    expect(previewMenu?.isPreview).toBe(true);
  });
});

describe("formatPrice", () => {
  it("formats integer cents as localised currency", () => {
    // German locale uses a comma decimal separator; English uses a dot.
    expect(formatPrice(1400, "EUR", "de-DE").replace(/\s| /g, " ").trim()).toMatch(
      /14,00 €|14,00€/,
    );
    expect(formatPrice(1400, "EUR", "en-GB")).toMatch(/€14\.00|€ 14.00/);
  });

  it("falls back gracefully on a bogus locale", () => {
    expect(formatPrice(2500, "EUR", "not-a-locale-!!!" as string)).toContain("25.00");
  });
});
