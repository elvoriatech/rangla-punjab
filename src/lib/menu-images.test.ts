import { describe, expect, it } from "vitest";
import { BRAND_ICONS, venueIcons } from "./menu-images";

describe("venueIcons", () => {
  // The per-venue logo swap was turned off on 2026-09-21: the owner wants
  // ONE favicon on every page, so a venue with an uploaded logo gets the
  // brand set exactly like one without.
  it("serves the brand icon set even when the venue has uploaded a logo", () => {
    const icons = venueIcons("tenant123/uploads/abc");
    expect(icons.icon.map((i) => i.url)).toEqual(["/favicon.ico?v=4", "/rangla-icon-180.png?v=4"]);
    expect(icons.apple[0]?.url).toBe("/rangla-icon-180.png?v=4");
    expect(icons.icon.some((i) => i.url.startsWith("/img/"))).toBe(false);
  });

  it("serves the same brand icon set without a logo", () => {
    for (const empty of [null, undefined, ""] as const) {
      const icons = venueIcons(empty);
      expect(icons.icon.map((i) => i.url)).toEqual([
        "/favicon.ico?v=4",
        "/rangla-icon-180.png?v=4",
      ]);
      expect(icons.apple[0]?.url).toBe("/rangla-icon-180.png?v=4");
    }
  });

  it("is the one shared constant — the root layout and the menu agree", () => {
    expect(venueIcons("tenant123/uploads/abc")).toBe(BRAND_ICONS);
    expect(venueIcons(null)).toBe(BRAND_ICONS);
  });
});
