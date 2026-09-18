import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { MENU_THEMES, resolveMenuTheme } from "./menu-themes";
import {
  buildBrandManifest,
  deriveScrim,
  buildExpoBrandConfig,
  deriveMobileBrand,
  deriveMobileColors,
  expoScheme,
  expoSlug,
  renderBrandModule,
} from "./mobile-brand";

const AA = 4.5;

/**
 * The pairings below are not aspirational — each one is a place in
 * mobile/src where the two tokens actually meet. Grep references are in the
 * labels so a future palette change can be traced back to the screen it
 * would break.
 */
const PAIRINGS: {
  label: string;
  fg: keyof ReturnType<typeof deriveMobileColors>;
  bg: keyof ReturnType<typeof deriveMobileColors>;
}[] = [
  { label: "header title on chrome (components.tsx headerTitle)", fg: "onRed", bg: "red" },
  { label: "header subtitle on chrome (components.tsx headerSubtitle)", fg: "goldSoft", bg: "red" },
  {
    label: "CTA label on the gold fill (components.tsx primaryBtnText)",
    fg: "ink",
    bg: "goldSoft",
  },
  { label: "dish price on a card (components.tsx dishPrice)", fg: "red", bg: "creamCard" },
  { label: "section action on the page (components.tsx sectionAction)", fg: "red", bg: "cream" },
  { label: "dish name on a card (components.tsx dishName)", fg: "ink", bg: "creamCard" },
  { label: "section title on the page (components.tsx sectionTitle)", fg: "ink", bg: "cream" },
  { label: "dish description on a card (components.tsx dishDesc)", fg: "inkSoft", bg: "creamCard" },
  { label: "muted body on the page", fg: "inkSoft", bg: "cream" },
  { label: "gold accent text on a card", fg: "gold", bg: "creamCard" },
  { label: "success text on a card", fg: "positive", bg: "creamCard" },
  { label: "error text on a card", fg: "danger", bg: "creamCard" },
];

describe("deriveMobileColors", () => {
  it.each(MENU_THEMES.map((theme) => theme.id))("clears WCAG AA on every pairing — %s", (id) => {
    const colors = deriveMobileColors(resolveMenuTheme(id));
    for (const { label, fg, bg } of PAIRINGS) {
      const ratio = contrastRatio(colors[fg], colors[bg]);
      expect(
        ratio,
        `${id}: ${fg} on ${bg} — ${label} (${ratio.toFixed(2)}:1)`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(MENU_THEMES.map((theme) => theme.id))("keeps cards distinct from the page — %s", (id) => {
    const colors = deriveMobileColors(resolveMenuTheme(id));
    expect(colors.creamCard).not.toBe(colors.cream);
    // Hairlines must be visible against the page without reading as text.
    expect(contrastRatio(colors.line, colors.cream)).toBeGreaterThan(1.15);
  });

  it("emits plain six-digit hex for every token", () => {
    for (const theme of MENU_THEMES) {
      for (const [token, value] of Object.entries(deriveMobileColors(theme))) {
        expect(value, `${theme.id}.${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("is deterministic — same theme in, same palette out", () => {
    expect(deriveMobileColors(resolveMenuTheme("rangla-royal"))).toEqual(
      deriveMobileColors(resolveMenuTheme("rangla-royal")),
    );
  });

  it("keeps the house look for rangla-royal: the theme's own red and cream ink", () => {
    const theme = resolveMenuTheme("rangla-royal");
    const colors = deriveMobileColors(theme);
    // The theme's page red already reads as text on parchment, so it survives
    // untouched — the app's chrome stays the approved Punjabi red.
    expect(colors.red).toBe(theme.vars.bg);
    expect(colors.onRed).toBe(theme.vars.text);
    expect(colors.goldSoft).toBe(theme.vars.accent);
  });

  it("borrows a light theme's own ink instead of inventing one", () => {
    const theme = resolveMenuTheme("ivory-day");
    const colors = deriveMobileColors(theme);
    expect(colors.cream).toBe(theme.vars.bg);
    expect(colors.creamCard).toBe(theme.vars.surface);
    expect(colors.ink).toBe(theme.vars.text);
  });

  it("falls back to the default theme for an unknown id", () => {
    expect(deriveMobileColors(resolveMenuTheme("does-not-exist"))).toEqual(
      deriveMobileColors(resolveMenuTheme(undefined)),
    );
  });
});

/** Composite `rgba(r, g, b, a)` over an opaque hex ground, as the app does. */
function composite(rgba: string, groundHex: string): string {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
  const ground = [
    parseInt(groundHex.slice(1, 3), 16),
    parseInt(groundHex.slice(3, 5), 16),
    parseInt(groundHex.slice(5, 7), 16),
  ];
  const mix = (fg: number, bg: number) => Math.round(fg * a + bg * (1 - a));
  return `#${[mix(r, ground[0]!), mix(g, ground[1]!), mix(b, ground[2]!)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function alphaOf(rgba: string): number {
  return Number(rgba.match(/[\d.]+/g)![3]);
}

describe("deriveScrim", () => {
  it.each(MENU_THEMES.map((theme) => theme.id))(
    "keeps hero ink legible over white artwork — %s",
    (id) => {
      const colors = deriveMobileColors(resolveMenuTheme(id));
      const ground = composite(deriveScrim(colors, "#ffffff"), "#ffffff");
      expect(contrastRatio(colors.onRed, ground)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(colors.goldSoft, ground)).toBeGreaterThanOrEqual(AA);
    },
  );

  it("needs less opacity over dark artwork than over light artwork", () => {
    const colors = deriveMobileColors(resolveMenuTheme("rangla-royal"));
    expect(alphaOf(deriveScrim(colors, "#1a1208"))).toBeLessThan(
      alphaOf(deriveScrim(colors, "#f6efe0")),
    );
  });

  it("assumes the worst when the artwork was not measured", () => {
    const measured = deriveMobileBrand({
      name: "X",
      slug: "x",
      themeId: "rangla-royal",
      heroGroundHex: "#2a1a0e",
    });
    const unmeasured = deriveMobileBrand({ name: "X", slug: "x", themeId: "rangla-royal" });
    expect(alphaOf(unmeasured.scrim)).toBeGreaterThan(alphaOf(measured.scrim));
  });
});

describe("expoSlug / expoScheme", () => {
  it.each([
    ["rangla-punjab", "rangla-punjab", "ranglapunjab"],
    ["Café Zähringer", "cafe-zahringer", "cafezahringer"],
    ["  Two  Words  ", "two-words", "twowords"],
    ["24-hour-diner", "24-hour-diner", "app24hourdiner"],
    ["--__--", "venue", "venue"],
    ["", "venue", "venue"],
  ])("%s → %s / %s", (raw, slug, scheme) => {
    expect(expoSlug(raw)).toBe(slug);
    expect(expoScheme(raw)).toBe(scheme);
  });

  it("bounds the slug and scheme lengths", () => {
    const long = "a".repeat(200);
    expect(expoSlug(long).length).toBeLessThanOrEqual(60);
    expect(expoScheme(long).length).toBeLessThanOrEqual(30);
  });
});

describe("deriveMobileBrand", () => {
  const input = {
    name: "Rangla Punjab",
    slug: "rangla-punjab",
    themeId: "rangla-royal",
    logoKey: "tenant-1/uploads/logo",
  };

  it("derives app identity from the venue slug", () => {
    const brand = deriveMobileBrand(input);
    expect(brand.app).toMatchObject({
      name: "Rangla Punjab",
      slug: "rangla-punjab",
      scheme: "ranglapunjab",
      version: "1.0.0",
      iosBundleIdentifier: "com.elvoria.ranglapunjab",
      androidPackage: "com.elvoria.ranglapunjab",
    });
  });

  it("honours a custom bundle prefix and version", () => {
    const brand = deriveMobileBrand({ ...input, bundlePrefix: "de.example", version: "2.4.0" });
    expect(brand.app.iosBundleIdentifier).toBe("de.example.ranglapunjab");
    expect(brand.app.version).toBe("2.4.0");
  });

  it("never lets a numeric slug produce an illegal package name", () => {
    const brand = deriveMobileBrand({ ...input, slug: "24-hour-diner" });
    expect(brand.app.androidPackage).toBe("com.elvoria.v24hourdiner");
    expect(brand.app.scheme).toBe("app24hourdiner");
  });

  it("falls back to the slug when the name is blank", () => {
    expect(deriveMobileBrand({ ...input, name: "   " }).app.name).toBe("rangla-punjab");
  });

  it("drops the monochrome icon when the logo has no alpha", () => {
    expect(deriveMobileBrand({ ...input, monochrome: false }).assets.adaptiveMonochrome).toBeNull();
    const config = buildExpoBrandConfig(deriveMobileBrand({ ...input, monochrome: false }));
    const android = config.android as { adaptiveIcon: Record<string, string> };
    expect(android.adaptiveIcon.monochromeImage).toBeUndefined();
  });
});

describe("buildExpoBrandConfig", () => {
  const brand = deriveMobileBrand({
    name: "Rangla Punjab",
    slug: "rangla-punjab",
    themeId: "rangla-royal",
    logoKey: null,
    apiUrl: "https://menu.example.com",
  });

  it("points every icon slot at the generated assets", () => {
    const config = buildExpoBrandConfig(brand);
    expect(config.icon).toBe("./assets/generated/icon.png");
    expect(config.splash).toEqual({
      image: "./assets/generated/splash.png",
      resizeMode: "contain",
      backgroundColor: brand.colors.red,
    });
    const android = config.android as { adaptiveIcon: Record<string, string> };
    expect(android.adaptiveIcon).toEqual({
      backgroundColor: brand.colors.red,
      foregroundImage: "./assets/generated/adaptive-foreground.png",
      backgroundImage: "./assets/generated/adaptive-background.png",
      monochromeImage: "./assets/generated/adaptive-monochrome.png",
    });
    expect(config.web).toEqual({ favicon: "./assets/generated/favicon.png" });
  });

  it("carries the venue identity into extra.brand for the runtime", () => {
    const extra = buildExpoBrandConfig(brand).extra as { brand: Record<string, unknown> };
    expect(extra.brand).toEqual({
      venueSlug: "rangla-punjab",
      venueName: "Rangla Punjab",
      themeId: "rangla-royal",
      apiUrl: "https://menu.example.com",
    });
  });

  it("omits apiUrl entirely when the build supplies it", () => {
    const noApi = deriveMobileBrand({ name: "X", slug: "x", themeId: "ivory-day" });
    const extra = buildExpoBrandConfig(noApi).extra as { brand: Record<string, unknown> };
    expect(extra.brand).not.toHaveProperty("apiUrl");
  });

  it("omits nothing the manifest consumer needs", () => {
    const manifest = buildBrandManifest(brand) as Record<string, unknown>;
    expect(Object.keys(manifest)).toEqual([
      "$generated",
      "venue",
      "colors",
      "scrim",
      "assets",
      "expo",
    ]);
  });
});

describe("renderBrandModule", () => {
  const brand = deriveMobileBrand({
    name: 'Zé "Bistro"',
    slug: "ze-bistro",
    themeId: "mughal-night",
    logoKey: null,
  });

  it("emits every token the app imports", () => {
    const source = renderBrandModule(brand);
    for (const [token, value] of Object.entries(brand.colors)) {
      expect(source).toContain(`${token}: "${value}",`);
    }
    expect(source).toContain("export const colors = {");
    expect(source).toContain("export const brand = {");
    expect(source).toContain('require("../assets/generated/logo.png")');
    expect(source).toContain('require("../assets/generated/hero.jpg")');
    expect(source).toContain(`export const scrim = "${brand.scrim}"`);
  });

  it("escapes a venue name containing quotes", () => {
    expect(renderBrandModule(brand)).toContain('name: "Zé \\"Bistro\\""');
  });
});
