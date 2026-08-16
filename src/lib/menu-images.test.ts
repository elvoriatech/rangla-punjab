import { describe, expect, it } from "vitest";
import { venueIcons } from "./menu-images";

describe("venueIcons", () => {
  it("serves the venue logo as favicon + touch icon when a logo exists", () => {
    const icons = venueIcons("tenant123/uploads/abc");
    expect(icons.icon[0]?.url).toBe("/img/tenant123%2Fuploads%2Fabc?w=64&fmt=png");
    expect(icons.apple[0]?.url).toBe("/img/tenant123%2Fuploads%2Fabc?w=180&fmt=png");
  });

  it("falls back to the full Guesto icon set without a logo", () => {
    for (const empty of [null, undefined, ""] as const) {
      const icons = venueIcons(empty);
      expect(icons.icon.map((i) => i.url)).toEqual(["/favicon.ico", "/rangla-icon-180.png"]);
      expect(icons.apple[0]?.url).toBe("/rangla-icon-180.png");
    }
  });
});
