import { describe, expect, it } from "vitest";
import { heroSlidesOf, MAX_HERO_SLIDES } from "./hero-slides";

describe("heroSlidesOf", () => {
  it("keeps non-empty string keys in order", () => {
    expect(heroSlidesOf(["a", "", 3, null, "b"])).toEqual(["a", "b"]);
  });

  it("reads anything that isn't an array as no slides", () => {
    expect(heroSlidesOf(undefined)).toEqual([]);
    expect(heroSlidesOf("a")).toEqual([]);
    expect(heroSlidesOf({ 0: "a" })).toEqual([]);
  });

  it("caps the list at the maximum", () => {
    const many = Array.from({ length: MAX_HERO_SLIDES + 3 }, (_, i) => `k${i}`);
    expect(heroSlidesOf(many)).toHaveLength(MAX_HERO_SLIDES);
  });
});
