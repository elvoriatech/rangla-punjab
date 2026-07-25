import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { signupUser } from "./auth-service";
import { asTenant, asUser } from "./tenant";
import {
  completeOnboarding,
  getOnboardingState,
  saveStep1,
  saveStep2,
  saveStep3,
} from "./onboarding-service";

describe("onboarding wizard service", () => {
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  async function seed(): Promise<{ userId: string; tenantId: string }> {
    const email = `p1-4-${randomUUID()}@ex.com`;
    const signup = await signupUser({
      email,
      password: "S3cureP4ssPhrase!",
      tenantName: "Signup Placeholder",
    });
    if (!signup.ok) throw new Error("seed signup failed");
    createdUserIds.push(signup.userId);
    createdTenantIds.push(signup.tenantId);
    return { userId: signup.userId, tenantId: signup.tenantId };
  }

  afterEach(async () => {
    for (const tid of createdTenantIds) {
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

  it("walks all four steps and materialises a venue with branding on complete", async () => {
    const { userId, tenantId } = await seed();

    // Starts at step 1.
    const initial = await getOnboardingState(userId);
    expect(initial.state.step).toBe(1);
    expect(initial.completed).toBe(false);

    // Step 1 → venue name saved, step advances to 2.
    expect((await saveStep1(userId, { venueName: "Ristorante Volpe" })).ok).toBe(true);
    expect((await getOnboardingState(userId)).state.step).toBe(2);

    // Step 2 → import branch saved.
    expect((await saveStep2(userId, { importBranch: "manual" })).ok).toBe(true);
    expect((await getOnboardingState(userId)).state.step).toBe(3);

    // Step 3 → branding saved (contrast passes for elvoria green on cream).
    expect(
      (await saveStep3(userId, { primaryColor: "#1f3b2e", logoKey: "logos/demo.png" })).ok,
    ).toBe(true);
    const beforeComplete = await getOnboardingState(userId);
    expect(beforeComplete.state.step).toBe(4);
    expect(beforeComplete.state.venueName).toBe("Ristorante Volpe");
    expect(beforeComplete.state.primaryColor).toBe("#1f3b2e");

    // Complete → tenant stamped, venue materialised with branding.
    expect((await completeOnboarding(userId)).ok).toBe(true);
    const after = await getOnboardingState(userId);
    expect(after.completed).toBe(true);

    const venues = await asUser(userId, (tx) => tx.venue.findMany());
    expect(venues).toHaveLength(1);
    expect(venues[0]!.name).toBe("Ristorante Volpe");
    expect(venues[0]!.tenantId).toBe(tenantId);
    expect(venues[0]!.branding).toMatchObject({
      primaryColor: "#1f3b2e",
      logoKey: "logos/demo.png",
    });
  });

  it("rejects a primary colour that fails WCAG AA against the cream background", async () => {
    const { userId } = await seed();
    await saveStep1(userId, { venueName: "V" });
    await saveStep2(userId, { importBranch: "manual" });
    const step3 = await saveStep3(userId, { primaryColor: "#d6b788" }); // pale gold
    expect(step3.ok).toBe(false);
    expect(step3.error).toMatch(/WCAG/);
    // Contrast guard should hand back a nearest-passing suggestion so the
    // wizard UI can offer a one-click nudge (P1-24).
    expect(step3.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    // State did not advance to 4.
    const state = await getOnboardingState(userId);
    expect(state.state.step).toBe(3);
  });

  it("complete is a no-op when onboarding is incomplete", async () => {
    const { userId } = await seed();
    await saveStep1(userId, { venueName: "Half-way" });
    const result = await completeOnboarding(userId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/incomplete/);
    const venues = await asUser(userId, (tx) => tx.venue.findMany());
    expect(venues).toHaveLength(0);
  });

  it("complete is idempotent", async () => {
    const { userId } = await seed();
    await saveStep1(userId, { venueName: "Idempotent" });
    await saveStep2(userId, { importBranch: "manual" });
    await saveStep3(userId, { primaryColor: "#1f3b2e" });
    expect((await completeOnboarding(userId)).ok).toBe(true);
    // Second call short-circuits — no error, no extra venue row.
    expect((await completeOnboarding(userId)).ok).toBe(true);
    const venues = await asUser(userId, (tx) => tx.venue.findMany());
    expect(venues).toHaveLength(1);
  });
});
