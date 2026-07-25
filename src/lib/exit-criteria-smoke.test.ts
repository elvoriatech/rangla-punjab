import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { saveStep1, saveStep2, saveStep3, completeOnboarding } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import { createCategory } from "./categories-service";
import { createItem } from "./items-service";
import { publishDraft } from "./menu-versions-service";
import { loadPublicMenu } from "./public-menu";
import { resolvePreviewContext } from "./preview-context";
import { renderPrintPack } from "./print-pack";
import { createCheckout } from "./billing-service";

/**
 * Phase 1 exit smoke (P1-30).
 *
 * Individual services already have their own unit + integration
 * coverage; this test intentionally *composes* them into a single
 * happy-path story so an integration regression — one system silently
 * mismatching another's contract — is caught before we invite the
 * first paying tenant. Runs against the same docker-compose stack the
 * rest of the vitest suite uses.
 *
 * External vendors run in their in-repo fake modes:
 *   - Billing: fake Stripe provider (P1-19) — no live Stripe call.
 * Flipping to live keys is human-gated at deploy (P6-3).
 *
 * The other Phase 1 gates (axe on `/r/[slug]`, LHCI mobile budget,
 * legal-ready advisory, RLS cross-tenant test, image build) already
 * run in the same CI job (`.github/workflows/ci.yml`). Verify green
 * on this file plus that workflow = Phase 1 exit gate satisfied.
 */

describe("Phase 1 exit-criteria smoke (P1-30)", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tid of createdTenantIds) {
      await asTenant(tid, (tx) => tx.itemVariant.deleteMany({}));
      await asTenant(tid, (tx) => tx.item.deleteMany({}));
      await asTenant(tid, (tx) => tx.category.deleteMany({}));
      await asTenant(tid, (tx) => tx.menu.updateMany({ data: { publishedVersion: null } }));
      await asTenant(tid, (tx) => tx.menuVersion.deleteMany({}));
      await asTenant(tid, (tx) => tx.menu.deleteMany({}));
      await asTenant(tid, (tx) => tx.venue.deleteMany({}));
      await asTenant(tid, (tx) => tx.media.deleteMany({}));
      await asTenant(tid, (tx) => tx.subscription.deleteMany({}));
      await asTenant(tid, (tx) => tx.membership.deleteMany({}));
      await asTenant(tid, (tx) => tx.tenant.deleteMany({}));
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  });

  it("signup → onboarding → build menu → publish → public render → QR PDF → billing checkout", async () => {
    // ---- 1. Signup ---------------------------------------------------
    const email = `p1-30-smoke-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Smoke Trattoria",
    });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);

    // ---- 2. Onboarding wizard ---------------------------------------
    expect((await saveStep1(signup.userId, { venueName: "Smoke Trattoria" })).ok).toBe(true);
    expect((await saveStep2(signup.userId, { importBranch: "manual" })).ok).toBe(true);
    expect((await saveStep3(signup.userId, { primaryColor: "#1f3b2e" })).ok).toBe(true);
    expect((await completeOnboarding(signup.userId)).ok).toBe(true);

    const venue = await asUser(signup.userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { id: true, tenantId: true, slug: true } }),
    );

    // ---- 3. Build the menu by hand (2 categories, 3 items) ----------
    const starters = await createCategory(signup.userId, { name: "Starters" });
    const mains = await createCategory(signup.userId, { name: "Mains" });
    expect(starters.ok && mains.ok).toBe(true);
    if (!starters.ok || !mains.ok) return;
    for (const [categoryId, name] of [
      [starters.value.id, "Bruschetta"],
      [mains.value.id, "Margherita"],
      [mains.value.id, "Carbonara"],
    ] as const) {
      const item = await createItem(signup.userId, {
        categoryId,
        name,
        priceCents: 1200,
        variants: [],
      });
      expect(item.ok).toBe(true);
    }

    // ---- 4. Publish → public render ---------------------------------
    const publish = await publishDraft(signup.userId);
    expect(publish.ok).toBe(true);
    const ctx = await resolvePreviewContext(venue.slug, null);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    const publicMenu = await loadPublicMenu(ctx);
    expect(publicMenu).not.toBeNull();
    if (!publicMenu) return;
    expect(publicMenu.categories).toHaveLength(2);
    expect(publicMenu.categories.reduce((n, c) => n + c.items.length, 0)).toBe(3);

    // ---- 5. QR PDF ---------------------------------------------------
    const pdfBytes = await renderPrintPack({
      venueName: publicMenu.venue.name,
      baseUrl: "https://elvoria.example",
      slug: venue.slug,
      tableCount: 3,
    });
    // Minimal sanity: real PDF header + non-trivial size.
    expect(pdfBytes.length).toBeGreaterThan(2000);
    const header = Buffer.from(pdfBytes.subarray(0, 5)).toString("utf8");
    expect(header).toBe("%PDF-");

    // ---- 6. Billing test-mode checkout ------------------------------
    const checkout = await createCheckout(signup.userId, "support", {
      successUrl: "https://elvoria.example/billing/success",
      cancelUrl: "https://elvoria.example/billing/cancel",
    });
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;
    expect(checkout.url).toMatch(/^https?:\/\//);
  });
});
