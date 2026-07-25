import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { completeOnboarding, saveStep1, saveStep2, saveStep3 } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import { createCategory } from "./categories-service";
import { createItem } from "./items-service";
import { publishDraft } from "./menu-versions-service";
import { listPublicVenues } from "./public-menu";

describe("listPublicVenues (sitemap seam)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  async function published(): Promise<{ userId: string; tenantId: string; slug: string }> {
    const email = `p1-12-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Placeholder",
    });
    if (!signup.ok) throw new Error();
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    await saveStep1(signup.userId, { venueName: "Ristorante Volpe" });
    await saveStep2(signup.userId, { importBranch: "manual" });
    await saveStep3(signup.userId, { primaryColor: "#1f3b2e" });
    await completeOnboarding(signup.userId);
    const cat = await createCategory(signup.userId, { name: "Mains" });
    if (!cat.ok) throw new Error();
    await createItem(signup.userId, {
      categoryId: cat.value.id,
      name: "Risotto",
      priceCents: 1800,
      variants: [],
    });
    if (!(await publishDraft(signup.userId)).ok) throw new Error();
    const venue = await asUser(signup.userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { slug: true } }),
    );
    return { userId: signup.userId, tenantId: signup.tenantId, slug: venue.slug };
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

  it("includes a published venue with its enabled locales", async () => {
    const { slug } = await published();
    const rows = await listPublicVenues();
    const ours = rows.find((r) => r.slug === slug);
    expect(ours).toBeDefined();
    expect(ours?.enabledLocales).toEqual(expect.arrayContaining(["en", "de"]));
  });

  it("excludes venues that have never published", async () => {
    // Onboarding creates a Menu with `publishedVersion=null` — the SECURITY
    // DEFINER filter must skip it.
    const email = `p1-12-unpub-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Placeholder",
    });
    if (!signup.ok) throw new Error();
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    await saveStep1(signup.userId, { venueName: "Never Published" });
    await saveStep2(signup.userId, { importBranch: "manual" });
    await saveStep3(signup.userId, { primaryColor: "#1f3b2e" });
    await completeOnboarding(signup.userId);
    const venue = await asUser(signup.userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { slug: true } }),
    );

    const rows = await listPublicVenues();
    expect(rows.find((r) => r.slug === venue.slug)).toBeUndefined();
  });
});
