import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERO_SLIDES,
  MAX_HERO_SLIDES,
  builtInLabel,
  heroSlideUrl,
  heroSlidesOf,
} from "./hero-slides";

describe("heroSlidesOf", () => {
  it("starts a venue that never touched its slider on the four built-in dishes", () => {
    expect(heroSlidesOf(undefined)).toEqual([...DEFAULT_HERO_SLIDES]);
    expect(DEFAULT_HERO_SLIDES).toHaveLength(4);
  });

  it("keeps an explicitly emptied list empty", () => {
    expect(heroSlidesOf([])).toEqual([]);
  });

  it("keeps valid keys in order and drops junk and unknown built-ins", () => {
    expect(heroSlidesOf(["a", "", 3, null, "builtin:hero-kebab", "builtin:../x", "b"])).toEqual([
      "a",
      "builtin:hero-kebab",
      "b",
    ]);
  });

  it("reads anything else that isn't an array as no slides", () => {
    expect(heroSlidesOf("a")).toEqual([]);
    expect(heroSlidesOf({ 0: "a" })).toEqual([]);
  });

  it("caps the list at the maximum", () => {
    const many = Array.from({ length: MAX_HERO_SLIDES + 3 }, (_, i) => `k${i}`);
    expect(heroSlidesOf(many)).toHaveLength(MAX_HERO_SLIDES);
  });
});

describe("heroSlideUrl", () => {
  it("serves built-ins from /app-slider and uploads through /img", () => {
    expect(heroSlideUrl("builtin:hero-karahi", 480)).toBe("/app-slider/hero-karahi.webp");
    expect(heroSlideUrl("t/uploads/x", 480)).toBe("/img/t%2Fuploads%2Fx?w=480");
    expect(builtInLabel("builtin:hero-karahi")).toBe("Karahi");
    expect(builtInLabel("t/uploads/x")).toBeNull();
  });
});
