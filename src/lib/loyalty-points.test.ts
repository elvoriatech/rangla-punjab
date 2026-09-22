import { describe, expect, it } from "vitest";
import { pointsForFood } from "./loyalty-points";

const RULE = { minOrderCents: 2000, pointsPerOrder: 5 };

describe("pointsForFood — 5 points per full €20 of food", () => {
  it("earns nothing below the first step", () => {
    expect(pointsForFood(RULE, 0)).toBe(0);
    expect(pointsForFood(RULE, 1999)).toBe(0);
  });

  it("earns per FULL step, rounding down", () => {
    expect(pointsForFood(RULE, 2000)).toBe(5);
    expect(pointsForFood(RULE, 3999)).toBe(5);
    expect(pointsForFood(RULE, 4000)).toBe(10);
    expect(pointsForFood(RULE, 6000)).toBe(15);
  });

  it("falls back to a flat amount when there is no threshold, and to 0 when switched off", () => {
    expect(pointsForFood({ minOrderCents: 0, pointsPerOrder: 5 }, 12345)).toBe(5);
    expect(pointsForFood({ minOrderCents: 2000, pointsPerOrder: 0 }, 9000)).toBe(0);
  });
});
