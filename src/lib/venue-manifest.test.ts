import { describe, expect, it } from "vitest";
import { buildVenueManifest } from "./venue-manifest";
import { MENU_THEMES } from "./menu-themes";

describe("buildVenueManifest", () => {
  it("scopes the app to the restaurant's public menu at the root and uses its theme colours", () => {
    const royal = MENU_THEMES.find((t) => t.id === "royal-sapphire");
    const m = buildVenueManifest({
      name: "Indisches Restaurant",
      theme: "royal-sapphire",
      logoKey: null,
    });
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe(royal?.vars.bg);
    expect(m.background_color).toBe(royal?.vars.bg);
  });

  it("uses the uploaded logo through the image proxy, PNG at install sizes", () => {
    const m = buildVenueManifest({
      name: "X",
      logoKey: "tenant-1/uploads/logo",
    });
    expect(m.icons).toEqual([
      {
        src: "/img/tenant-1%2Fuploads%2Flogo?w=192&fmt=png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/img/tenant-1%2Fuploads%2Flogo?w=512&fmt=png",
        sizes: "512x512",
        type: "image/png",
      },
    ]);
  });

  it("falls back to the brand mark and default theme when unbranded", () => {
    const m = buildVenueManifest({ name: "Indisches Restaurant Ganesha" });
    expect(m.icons[0]?.src).toBe("/brand/icon-192.png");
    expect(m.theme_color).toMatch(/^#/);
    // Truncated to a home-screen-friendly label, no trailing space.
    expect(m.short_name).toBe("Indisches Re");
    expect(buildVenueManifest({ name: "Ganesha" }).short_name).toBe("Ganesha");
  });
});
