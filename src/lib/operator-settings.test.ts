import { describe, expect, it } from "vitest";
import {
  computePlatformFeeCents,
  DEFAULT_OPERATOR_SETTINGS,
  type OperatorSettings,
} from "./operator-settings";

const base: OperatorSettings = DEFAULT_OPERATOR_SETTINGS;

/**
 * Single-restaurant white-label rule: the restaurant runs its OWN
 * payment gateways and keeps 100% of every order. The platform fee is
 * structurally zero — no configuration may ever reintroduce it.
 */
describe("computePlatformFeeCents (no commission, ever)", () => {
  it("charges 0 for any amount under default settings", () => {
    expect(computePlatformFeeCents(50, base)).toBe(0);
    expect(computePlatformFeeCents(2001, base)).toBe(0);
    expect(computePlatformFeeCents(10_000, base)).toBe(0);
    expect(computePlatformFeeCents(1_000_000, base)).toBe(0);
  });

  it("charges 0 even when settings try to configure a fee", () => {
    const aggressive: OperatorSettings = {
      ...base,
      feeMode: "percentage",
      feeBp: 2500,
      feeMinCents: 0,
    };
    expect(computePlatformFeeCents(10_000, aggressive)).toBe(0);
    const upfront: OperatorSettings = { ...base, feeMode: "upfront" };
    expect(computePlatformFeeCents(10_000, upfront)).toBe(0);
  });
});
