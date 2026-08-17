import { describe, expect, it } from "vitest";
import {
  MENU_BACKDROPS,
  MENU_THEMES,
  menuThemeStyle,
  resolveBackdropGradient,
} from "./menu-themes";

/**
 * WCAG contrast guard for EVERY theme and every theme × backdrop pairing.
 * A theme that ships an unreadable combination fails CI, so "check all
 * combinations" stays checked forever, not once.
 *
 * Thresholds: 4.5:1 for body-size text, 3:1 for large text / UI accents
 * (WCAG 2.1 AA).
 */

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme palettes are readable (AA)", () => {
  for (const t of MENU_THEMES) {
    it(`${t.id}: every token pair clears its threshold`, () => {
      const v = t.vars;
      const cardInk = v.surfaceText ?? v.text;
      const cardSoft = v.surfaceTextSoft ?? v.textSoft;
      const cardAccent = v.surfaceAccent ?? v.accent;
      const checks: [string, number, number][] = [
        ["page text on bg", ratio(v.text, v.bg), 4.5],
        ["page soft text on bg", ratio(v.textSoft, v.bg), 4.5],
        ["accent on bg (headings/large)", ratio(v.accent, v.bg), 3.0],
        ["card ink on surface", ratio(cardInk, v.surface), 4.5],
        ["card soft ink on surface", ratio(cardSoft, v.surface), 4.5],
        ["card accent on surface (price)", ratio(cardAccent, v.surface), 3.0],
        ["positive badge on surface", ratio(v.positive, v.surface), 3.0],
      ];
      const fails = checks
        .filter(([, r, min]) => r < min)
        .map(([name, r, min]) => `${name}: ${r.toFixed(2)} < ${min}`);
      expect(fails, fails.join("; ")).toEqual([]);
    });
  }
});

describe("backdrops declare an ink polarity and it is readable", () => {
  const grounded = MENU_BACKDROPS.filter((b) => b.image || b.gradient);

  it("every image/gradient backdrop declares ink", () => {
    for (const b of grounded) {
      expect(b.ink, `backdrop '${b.id}' must declare ink`).toMatch(/^(light|dark)$/);
    }
  });

  it("gradient stops all clear 4.5:1 against the declared ink", () => {
    const LIGHT_INK = "#fdf3dd";
    const DARK_INK = "#2a1a0e";
    for (const b of grounded) {
      if (!b.gradient) continue;
      const css = resolveBackdropGradient(b, "#8f1a1a")!;
      const stops = [...css.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
      const ink = b.ink === "dark" ? DARK_INK : LIGHT_INK;
      for (const stop of stops) {
        expect(
          ratio(ink, stop),
          `${b.id}: ink ${ink} on stop ${stop} = ${ratio(ink, stop).toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("menuThemeStyle overrides page ink for EVERY theme × backdrop pairing", () => {
    for (const t of MENU_THEMES) {
      for (const b of grounded) {
        const style = menuThemeStyle(t.id, null, b.id) as Record<string, string>;
        const text = style["--menu-text"];
        expect(text, `${t.id} × ${b.id} sets page text`).toBeDefined();
        // The override must be the polarity ink, not the theme's own text.
        expect(text).toBe(b.ink === "dark" ? "#2a1a0e" : "#fdf3dd");
      }
    }
  });
});
