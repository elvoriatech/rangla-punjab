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
  it("grants full access unless suspended or deleted", () => {
    const noSub = resolveTenantAccess(tenant(), NOW);
    expect(noSub.state).toBe("active");
    expect(noSub.plan).toBe("support");
    expect(noSub.menuVisible).toBe(true);
    expect(noSub.entitlements.payments).toBe(true);

    // An overdue support fee must NOT gate features — billing is warn-only.
    // A very old tenant never "lapses" — no trial clock exists anymore.
    const old = resolveTenantAccess(tenant({ createdAt: new Date("2020-01-01T00:00:00Z") }), NOW);
    expect(old.state).toBe("active");
    expect(old.menuVisible).toBe(true);
  });

  it("feature overrides flip single switches off on top of all-on", () => {
    const a = resolveTenantAccess(
      tenant({ entitlementOverrides: { delivery: false, junk: "yes" } }),
      NOW,
    );
    expect(a.entitlements.delivery).toBe(false);
    expect(a.entitlements.dineIn).toBe(true);
  });

  it("suspension kills everything", () => {
    const a = resolveTenantAccess(tenant({ status: "suspended" }), NOW);
    expect(a.state).toBe("suspended");
    expect(a.entitlements.dineIn).toBe(false);
    expect(a.menuVisible).toBe(false);
  });

  it("soft-deleted tenants have no access or public menu", () => {
    const a = resolveTenantAccess(tenant({ deletedAt: NOW }), NOW);
    expect(a.state).toBe("deleted");
    expect(a.menuVisible).toBe(false);
  });
});
