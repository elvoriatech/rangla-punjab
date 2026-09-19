import { describe, expect, it } from "vitest";
import {
  LOYALTY_DEFAULTS,
  loyaltyActive,
  parseLoyaltyConfig,
  publicLoyalty,
} from "./loyalty-config";

/**
 * The loyalty config is read on every settled order and on every public
 * menu response, so "a hand-edited JSONB blob must never throw" is the
 * property that actually matters here — not the happy path.
 */
describe("loyalty config", () => {
  it("defaults to OFF with the owner's documented starting numbers", () => {
    const config = parseLoyaltyConfig({});
    expect(config).toEqual({
      enabled: false,
      minOrderCents: 2000,
      pointsPerOrder: 5,
      rewardPoints: 100,
      rewardValueCents: 2000,
      voucherExpiryMonths: 0,
    });
    // null / undefined / a non-object all land on the same defaults —
    // a venue row that was never touched behaves like one that was reset.
    expect(parseLoyaltyConfig(null)).toEqual(config);
    expect(parseLoyaltyConfig(undefined)).toEqual(config);
    expect(parseLoyaltyConfig("not json at all")).toEqual(config);
    expect(config).toEqual({ ...LOYALTY_DEFAULTS });
  });

  it("keeps the owner's values when they are sane", () => {
    expect(
      parseLoyaltyConfig({
        enabled: true,
        minOrderCents: 1500,
        pointsPerOrder: 10,
        rewardPoints: 60,
        rewardValueCents: 1000,
        voucherExpiryMonths: 2,
      }),
    ).toEqual({
      enabled: true,
      minOrderCents: 1500,
      pointsPerOrder: 10,
      rewardPoints: 60,
      rewardValueCents: 1000,
      voucherExpiryMonths: 2,
    });
  });

  it("falls each junk field back to its own default instead of failing the save", () => {
    const config = parseLoyaltyConfig({
      enabled: "yes please",
      minOrderCents: null,
      pointsPerOrder: -4,
      rewardPoints: NaN,
      rewardValueCents: "abc",
      voucherExpiryMonths: 999,
    });
    // A non-boolean switch must never read as ON — that would start
    // promising points to guests off the back of a typo.
    expect(config.enabled).toBe(false);
    expect(config.minOrderCents).toBe(2000);
    expect(config.pointsPerOrder).toBe(5);
    expect(config.rewardPoints).toBe(100);
    expect(config.rewardValueCents).toBe(2000);
    // Out of range is treated like any other unusable value: back to the
    // default (0 = end of this month), which is the conservative choice —
    // never a 999-month voucher the owner never meant to grant.
    expect(config.voucherExpiryMonths).toBe(0);
  });

  it("accepts the decimal strings the settings form posts and rounds to cents", () => {
    const config = parseLoyaltyConfig({ minOrderCents: "2550.4", rewardValueCents: "1000" });
    expect(config.minOrderCents).toBe(2550);
    expect(config.rewardValueCents).toBe(1000);
  });

  it("treats 0 as a real value, not a missing one", () => {
    // "earn on any order" is a legitimate setting and must survive.
    expect(parseLoyaltyConfig({ minOrderCents: 0 }).minOrderCents).toBe(0);
  });

  it("only calls loyalty active when it can actually award something", () => {
    const on = { ...LOYALTY_DEFAULTS, enabled: true };
    expect(loyaltyActive(parseLoyaltyConfig(on))).toBe(true);
    expect(loyaltyActive(parseLoyaltyConfig({ ...on, pointsPerOrder: 0 }))).toBe(false);
    expect(loyaltyActive(parseLoyaltyConfig({ ...on, rewardPoints: 0 }))).toBe(false);
    expect(loyaltyActive(parseLoyaltyConfig(LOYALTY_DEFAULTS))).toBe(false);
  });

  it("exposes exactly the five public fields on the menu payload", () => {
    expect(Object.keys(publicLoyalty(parseLoyaltyConfig({}))).sort()).toEqual([
      "enabled",
      "minOrderCents",
      "pointsPerOrder",
      "rewardPoints",
      "rewardValueCents",
    ]);
  });
});
