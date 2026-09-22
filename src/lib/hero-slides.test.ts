import { describe, expect, it } from "vitest";
import {
  BUILT_IN_SLIDES,
  DEFAULT_HERO_SLIDES,
  MAX_HERO_SLIDES,
  bannerSlideKey,
  builtInLabel,
  heroSlideFetchWidth,
  heroSlideKind,
  heroSlideUrl,
  heroSlidesOf,
  unusedBuiltInSlides,
} from "./hero-slides";

describe("heroSlidesOf", () => {
  it("starts an untouched venue on the four German posters", () => {
    expect(heroSlidesOf(undefined)).toEqual([
      "builtin:points-de",
      "builtin:welcome-de",
      "builtin:giftcard-de",
      "builtin:service-de",
    ]);
    expect(DEFAULT_HERO_SLIDES.length).toBeLessThanOrEqual(MAX_HERO_SLIDES);
  });

  it("keeps an explicitly emptied list empty", () => {
    expect(heroSlidesOf([])).toEqual([]);
  });

  it("keeps valid keys in order and drops junk and unknown built-ins", () => {
    expect(heroSlidesOf(["a", "", 3, null, "builtin:service-de", "builtin:../x", "b"])).toEqual([
      "a",
      "builtin:service-de",
      "b",
    ]);
  });

  it("drops the retired dish built-ins a venue may still have stored", () => {
    expect(
      heroSlidesOf(["builtin:points-de", "builtin:hero-kebab", "builtin:hero-biryani"]),
    ).toEqual(["builtin:points-de"]);
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
    expect(heroSlideUrl("builtin:giftcard-de", 1280)).toBe("/app-slider/giftcard-de.webp");
    expect(heroSlideUrl("t/uploads/x", 480)).toBe("/img/t%2Fuploads%2Fx?w=480");
    expect(builtInLabel("builtin:giftcard-de")).toBe("Gift-card banner (German)");
    expect(builtInLabel("t/uploads/x")).toBeNull();
  });
});

describe("slide kinds", () => {
  it("makes every built-in a banner, and tells uploads apart", () => {
    expect(BUILT_IN_SLIDES.every((s) => s.kind === "banner")).toBe(true);
    expect(heroSlideKind("builtin:points-de")).toBe("banner");
    expect(heroSlideKind(bannerSlideKey("t/uploads/p"))).toBe("banner");
    expect(heroSlideKind("t/uploads/d")).toBe("dish");
  });

  it("serves an uploaded banner through /img at the banner width", () => {
    const key = bannerSlideKey("t/uploads/p");
    expect(heroSlidesOf([key])).toEqual([key]);
    expect(heroSlideUrl(key, heroSlideFetchWidth(key))).toBe("/img/t%2Fuploads%2Fp?w=1280");
    expect(heroSlideFetchWidth("t/uploads/d")).toBe(480);
    expect(heroSlidesOf(["banner:"])).toEqual([]);
  });
});

describe("the built-in picker", () => {
  it("offers exactly the posters the slider isn't already carrying", () => {
    // The catalogue IS the default set today, so an untouched slider has
    // nothing left to offer and the picker stays out of the page.
    expect(unusedBuiltInSlides([...DEFAULT_HERO_SLIDES])).toEqual([]);
    expect(unusedBuiltInSlides([])).toHaveLength(BUILT_IN_SLIDES.length);
    expect(unusedBuiltInSlides(["builtin:points-de"]).map((b) => b.name)).toEqual([
      "welcome-de",
      "giftcard-de",
      "service-de",
    ]);
    // An upload never hides a built-in from the picker.
    expect(unusedBuiltInSlides(["t/uploads/x"])).toHaveLength(BUILT_IN_SLIDES.length);
  });
});
