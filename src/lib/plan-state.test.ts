import { describe, expect, it } from "vitest";
import { planEntitlements, resolveTenantAccess } from "./plan-state";

const NOW = new Date("2026-07-15T12:00:00Z");

function tenant(overrides: Partial<Parameters<typeof resolveTenantAccess>[0]> = {}) {
  return {
    createdAt: new Date("2026-01-01T00:00:00Z"),
    plan: null,
    entitlementOverrides: {},
    ...overrides,
  };
}

describe("planEntitlements", () => {
  it("the single support plan unlocks every feature", () => {
    expect(planEntitlements("support")).toEqual({
      dineIn: true,
      takeaway: true,
      delivery: true,
      kitchen: true,
      stats: true,
      payments: true,
    });
  });
});

describe("resolveTenantAccess (single restaurant — always on)", () => {
  it("grants full access regardless of subscription state", () => {
    const noSub = resolveTenantAccess(tenant(), null, NOW);
    expect(noSub.state).toBe("active");
    expect(noSub.plan).toBe("support");
    expect(noSub.menuVisible).toBe(true);
    expect(noSub.entitlements.payments).toBe(true);

    // An overdue support fee must NOT gate features — billing is warn-only.
    const pastDue = resolveTenantAccess(tenant(), {
      planCode: "support",
      status: "past_due",
      trialEnd: null,
      currentPeriodEnd: new Date(NOW.getTime() - 5 * 86_400_000),
    });
    expect(pastDue.state).toBe("active");
    expect(pastDue.entitlements.dineIn).toBe(true);
    expect(pastDue.menuVisible).toBe(true);

    // A very old tenant never "lapses" — no trial clock exists anymore.
    const old = resolveTenantAccess(
      tenant({ createdAt: new Date("2020-01-01T00:00:00Z") }),
      null,
      NOW,
    );
    expect(old.state).toBe("active");
    expect(old.menuVisible).toBe(true);
  });

  it("feature overrides flip single switches off on top of all-on", () => {
    const a = resolveTenantAccess(
      tenant({ entitlementOverrides: { delivery: false, junk: "yes" } }),
      null,
      NOW,
    );
    expect(a.entitlements.delivery).toBe(false);
    expect(a.entitlements.dineIn).toBe(true);
  });

  it("suspension kills everything", () => {
    const a = resolveTenantAccess(tenant({ status: "suspended" }), null, NOW);
    expect(a.state).toBe("suspended");
    expect(a.entitlements.dineIn).toBe(false);
    expect(a.menuVisible).toBe(false);
  });

  it("soft-deleted tenants have no access or public menu", () => {
    const a = resolveTenantAccess(tenant({ deletedAt: NOW }), null, NOW);
    expect(a.state).toBe("deleted");
    expect(a.menuVisible).toBe(false);
  });
});
