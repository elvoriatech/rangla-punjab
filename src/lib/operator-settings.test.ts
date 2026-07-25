import { describe, expect, it } from "vitest";
import {
  computePlatformFeeCents,
  DEFAULT_OPERATOR_SETTINGS,
  type OperatorSettings,
} from "./operator-settings";

const base: OperatorSettings = DEFAULT_OPERATOR_SETTINGS; // percentage / 500bp / 2000 / active

describe("computePlatformFeeCents (P2-2)", () => {
  it("charges 0 in upfront mode regardless of amount", () => {
    const upfront: OperatorSettings = { ...base, feeMode: "upfront" };
    expect(computePlatformFeeCents(10_000, upfront)).toBe(0);
    expect(computePlatformFeeCents(50, upfront)).toBe(0);
  });

  it("charges 0 at or below the minimum-order threshold", () => {
    expect(computePlatformFeeCents(2000, base)).toBe(0); // exactly at threshold
    expect(computePlatformFeeCents(1999, base)).toBe(0); // below
  });

  it("charges feeBp basis points strictly above the threshold", () => {
    expect(computePlatformFeeCents(2001, base)).toBe(100); // 5% of 2001 → 100.05 → 100
    expect(computePlatformFeeCents(10_000, base)).toBe(500); // €100 → €5.00
  });

  it("honours a custom fee rate", () => {
    const custom: OperatorSettings = { ...base, feeBp: 150 };
    expect(computePlatformFeeCents(10_000, custom)).toBe(150); // 1.5%
  });
});
