import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_THEME_ID,
  MENU_TEXTURES,
  MENU_THEMES,
  menuThemeStyle,
  resolveMenuTheme,
  resolveMenuTexture,
  textureBackgroundImage,
} from "./menu-themes";

/** WCAG relative luminance for a #rrggbb hex color. */
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

describe("menu themes", () => {
  it("resolves a known id, and falls back to the default for unknown/absent ids", () => {
    expect(resolveMenuTheme("ivory-day").id).toBe("ivory-day");
    expect(resolveMenuTheme("nope").id).toBe(DEFAULT_MENU_THEME_ID);
    expect(resolveMenuTheme(undefined).id).toBe(DEFAULT_MENU_THEME_ID);
    expect(resolveMenuTheme(null).id).toBe(DEFAULT_MENU_THEME_ID);
  });

  it("has unique ids", () => {
    const ids = MENU_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every theme declares a known layout", () => {
    for (const theme of MENU_THEMES) {
      expect(["editorial", "grid", "list", "showcase", "hero", "floating"], theme.id).toContain(
        theme.layout,
      );
    }
    expect(resolveMenuTheme("fresh-bistro").layout).toBe("grid");
    expect(resolveMenuTheme("royal-sapphire").layout).toBe("list");
    expect(resolveMenuTheme("garden-gold").layout).toBe("list");
    expect(resolveMenuTheme("trattoria-chalk").layout).toBe("showcase");
  });

  it("every theme's body text clears WCAG AA (4.5:1) against bg and surface", () => {
    for (const theme of MENU_THEMES) {
      expect
        .soft(contrast(theme.vars.text, theme.vars.bg), `${theme.id} text/bg`)
        .toBeGreaterThanOrEqual(4.5);
      // Split-surface themes (cream cards on a deep-red page) read
      // surfaceText inside cards; the plain-text-on-surface pair only
      // applies when the theme has no dedicated surface palette.
      const cardText = theme.vars.surfaceText ?? theme.vars.text;
      expect
        .soft(contrast(cardText, theme.vars.surface), `${theme.id} cardText/surface`)
        .toBeGreaterThanOrEqual(4.5);
      if (theme.vars.surfaceTextSoft) {
        expect
          .soft(
            contrast(theme.vars.surfaceTextSoft, theme.vars.surface),
            `${theme.id} surfaceTextSoft/surface`,
          )
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("every theme's accent (prices, headings) clears WCAG AA large-text (3:1)", () => {
    for (const theme of MENU_THEMES) {
      expect
        .soft(contrast(theme.vars.accent, theme.vars.bg), `${theme.id} accent/bg`)
        .toBeGreaterThanOrEqual(3);
      const cardAccent = theme.vars.surfaceAccent ?? theme.vars.accent;
      expect
        .soft(contrast(cardAccent, theme.vars.surface), `${theme.id} cardAccent/surface`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("style object carries every var the renderer reads", () => {
    const style = menuThemeStyle("mughal-night", "none") as Record<string, string>;
    for (const key of [
      "--menu-bg",
      "--menu-surface",
      "--menu-line",
      "--menu-text",
      "--menu-text-soft",
      "--menu-accent",
      "--menu-positive",
    ]) {
      expect(style[key], key).toBeTruthy();
    }
    expect(style.backgroundImage).toBeUndefined();
  });
});

describe("menu textures", () => {
  it("resolves known ids and falls back to plain", () => {
    expect(resolveMenuTexture("jali").id).toBe("jali");
    expect(resolveMenuTexture("nope").id).toBe("none");
  });

  it("plain texture produces no background image", () => {
    expect(textureBackgroundImage("none", MENU_THEMES[0]!)).toBeNull();
  });

  it("patterned textures produce an encoded data-URI with the theme's ink", () => {
    for (const texture of MENU_TEXTURES.filter((t) => t.svg)) {
      const css = textureBackgroundImage(texture.id, MENU_THEMES[0]!);
      expect(css).toMatch(/^url\("data:image\/svg\+xml,/);
      // The INK placeholder must never leak into the served CSS.
      expect(css).not.toContain("INK");
    }
  });

  it("texture flows into the wrapper style", () => {
    const style = menuThemeStyle("mughal-night", "jali") as Record<string, string>;
    expect(style.backgroundImage).toMatch(/^url\(/);
  });
});
