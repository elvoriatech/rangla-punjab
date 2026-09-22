import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERO_SLIDES,
  MAX_HERO_SLIDES,
  bannerSlideKey,
  builtInLabel,
  heroSlideFetchWidth,
  heroSlideKind,
  heroSlideUrl,
  heroSlidesOf,
} from "./hero-slides";

describe("heroSlidesOf", () => {
  it("starts an untouched venue on German banner → four dishes → English banner", () => {
    expect(heroSlidesOf(undefined)).toEqual([
      "builtin:points-de",
      "builtin:hero-biryani",
      "builtin:hero-kebab",
      "builtin:hero-karahi",
      "builtin:hero-biryani-2",
      "builtin:points-en",
    ]);
    expect(DEFAULT_HERO_SLIDES).toHaveLength(MAX_HERO_SLIDES);
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

describe("slide kinds", () => {
  it("tells banners from dishes, built-in or uploaded", () => {
    expect(heroSlideKind("builtin:points-de")).toBe("banner");
    expect(heroSlideKind("builtin:hero-kebab")).toBe("dish");
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
