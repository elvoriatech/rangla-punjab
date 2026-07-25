import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { completeOnboarding, saveStep1, saveStep2, saveStep3 } from "./onboarding-service";
import { asTenant, asUser } from "./tenant";
import { resolvePreviewContext } from "./preview-context";
import { signPreviewToken } from "./preview-token";

describe("resolvePreviewContext", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  async function onboarded(): Promise<{
    userId: string;
    tenantId: string;
    venueId: string;
    venueSlug: string;
  }> {
    const email = `p1-9-${randomUUID()}@ex.com`;
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
    const venue = await asUser(signup.userId, (tx) =>
      tx.venue.findFirstOrThrow({ select: { id: true, slug: true } }),
    );
    return {
      userId: signup.userId,
      tenantId: signup.tenantId,
      venueId: venue.id,
      venueSlug: venue.slug,
    };
  }

  afterEach(async () => {
    for (const tid of createdTenantIds) {
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

  it("public path resolves slug to venue and returns the published pointer", async () => {
    const { tenantId, venueId, venueSlug } = await onboarded();
    const ctx = await resolvePreviewContext(venueSlug, null);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    expect(ctx.mode).toBe("public");
    expect(ctx.venueId).toBe(venueId);
    expect(ctx.tenantId).toBe(tenantId);
    if (ctx.mode === "public") expect(ctx.publishedVersionId).toBeNull();
  });

  it("returns null for an unknown slug (route → 404)", async () => {
    const ctx = await resolvePreviewContext(`does-not-exist-${randomUUID()}`, null);
    expect(ctx).toBeNull();
  });

  it("preview token resolves to the draft version id", async () => {
    const { tenantId, venueId, venueSlug } = await onboarded();
    const token = signPreviewToken(tenantId, venueId);
    const ctx = await resolvePreviewContext(venueSlug, token);
    expect(ctx?.mode).toBe("preview");
    if (ctx?.mode !== "preview") return;
    expect(ctx.venueId).toBe(venueId);
    expect(typeof ctx.draftVersionId).toBe("string");
  });

  it("preview token for a venue that does not match the slug returns null", async () => {
    const a = await onboarded();
    const b = await onboarded();
    // Sign a token for tenant/venue B, then present it against tenant A's
    // slug. The token is well-formed but points at a different venue.
    const wrong = signPreviewToken(b.tenantId, b.venueId);
    const ctx = await resolvePreviewContext(a.venueSlug, wrong);
    expect(ctx).toBeNull();
  });

  it("expired preview token returns null", async () => {
    const { tenantId, venueId, venueSlug } = await onboarded();
    const expired = signPreviewToken(tenantId, venueId, 0);
    const ctx = await resolvePreviewContext(venueSlug, expired);
    expect(ctx).toBeNull();
  });

  it("malformed / bogus token returns null (does not fall through to public)", async () => {
    const { venueSlug } = await onboarded();
    const ctx = await resolvePreviewContext(venueSlug, "totally.not.a.token");
    expect(ctx).toBeNull();
  });
});
