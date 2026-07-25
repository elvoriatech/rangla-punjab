import { describe, expect, it } from "vitest";
import { PLAN_CODES, PLANS, SUPPORT_PLAN } from "./plans";

describe("PLANS catalogue", () => {
  it("exposes exactly one plan: support", () => {
    expect(PLAN_CODES).toEqual(["support"]);
  });

  it("is frozen — mutation throws in strict mode", () => {
    expect(Object.isFrozen(PLANS)).toBe(true);
    expect(Object.isFrozen(PLANS.support)).toBe(true);
    expect(() => {
      (PLANS.support as { priceMonthlyCents: number }).priceMonthlyCents = 9999;
    }).toThrow(TypeError);
  });

  it("the support plan carries a code + stripePriceIdEnv + a positive price", () => {
    expect(SUPPORT_PLAN.code).toBe("support");
    expect(PLANS.support).toBe(SUPPORT_PLAN);
    expect(SUPPORT_PLAN.stripePriceIdEnv).toBe("STRIPE_PRICE_ID_SUPPORT");
    expect(SUPPORT_PLAN.priceMonthlyCents).toBeGreaterThan(0);
    expect(SUPPORT_PLAN.features.length).toBeGreaterThan(0);
  });
});
