import { describe, expect, it } from "vitest";
import {
  MENU_BACKDROPS,
  MENU_THEMES,
  dangerFor,
  menuThemeStyle,
  onColorFor,
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

/**
 * sRGB composite of `fg` at `alpha` over `bg`.
 *
 * The cart drawer replaces borders with low-alpha washes, and Tailwind's `/7`
 * modifier emits `color-mix(in oklab, C 7%, transparent)` — i.e. C at 7% alpha,
 * which the browser then composites over the parent. The assertions below MUST
 * composite, or they measure the raw token instead of the pixel a guest sees:
 * an uncomposited wash "passes" for entirely the wrong reason (the wash alone
 * is ~1.15:1 against the surface; the recipe passes on the GLYPH sitting on it).
 */
function over(fg: string, bg: string, alpha: number): string {
  const parse = (hex: string): [number, number, number] => {
    const n = parseInt(/^#([0-9a-f]{6})$/i.exec(hex.trim())![1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const f = parse(fg);
  const b = parse(bg);
  const mix = f.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha)));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
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

/**
 * The cart drawer signals every control with a low-alpha WASH instead of a
 * border, because `--menu-line` against its own surface is 1.03–1.63:1 on 17
 * of the 19 themes (invisible) but 3.96:1 on rangla-royal and 18.13:1 on
 * street-bold — one border recipe cannot look right across the set, while a
 * tint of the surface ink is self-scaling.
 *
 * These are the exact alphas in cart-drawer.tsx's recipe constants. Change one
 * there, change it here. Two standing rules the numbers enforce:
 *   - ink carries all small text; accent is a fill/graphic color only (accent
 *     on surface is guaranteed at 3:1, not 4.5:1 — 3.28:1 on fresh-bistro)
 *   - labels stay FULL ink at rest and on hover; the wash carries the
 *     de-emphasis (soft ink on the 13% hover wash is ~3.96:1)
 *
 * garden-gold (#4c5c37, ink/surface 6.21:1) is the binding worst case for
 * nearly every recipe — check it first when touching any of this.
 */
describe("cart-drawer control recipes are readable on every theme", () => {
  for (const t of MENU_THEMES) {
    it(`${t.id}: every fill/ink pair clears its threshold`, () => {
      const v = t.vars;
      const surface = v.surface;
      const ink = v.surfaceText ?? v.text;
      const soft = v.surfaceTextSoft ?? v.textSoft;
      const accent = v.surfaceAccent ?? v.accent;
      const danger = dangerFor(surface);
      const checks: [string, number, number][] = [
        // Quiet controls: close ✕, qty −/+, Add items, idle chips.
        ["label on quiet wash", ratio(ink, over(ink, surface, 0.07)), 4.5],
        ["label on quiet hover wash", ratio(ink, over(ink, surface, 0.13)), 4.5],
        // Text fields.
        ["value on field wash", ratio(ink, over(ink, surface, 0.06)), 4.5],
        ["placeholder on field wash", ratio(soft, over(ink, surface, 0.06)), 4.5],
        // Selected order-type chip.
        ["label on selected chip", ratio(ink, over(accent, surface, 0.14)), 4.5],
        // Destructive: the WORDS are ink, only the glyph/rail takes the hue.
        ["label on danger wash", ratio(ink, over(danger, surface, 0.12)), 4.5],
        ["danger glyph on danger wash", ratio(danger, over(danger, surface, 0.12)), 3.0],
        ["danger text on plain surface", ratio(danger, surface), 4.5],
        // Non-text affordances: field underline, selected-chip indicator bar.
        ["accent underline / indicator bar", ratio(accent, surface), 3.0],
        // Focus ring — ink, because ink-vs-surface is the one pair guaranteed
        // on every theme AND every backdrop pairing.
        ["focus ring on surface", ratio(ink, surface), 3.0],
        // Solid CTAs.
        ["primary CTA label on accent fill", ratio(onColorFor(accent), accent), 4.5],
        ["pay CTA label on positive fill", ratio(onColorFor(v.positive), v.positive), 4.5],
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

  /**
   * The companion to the page-ink assertion below. That one proves the PAGE
   * ink follows the backdrop's polarity; this one proves the CARD palette does
   * NOT — the guarantee the comment in menuThemeStyle always claimed but the
   * code only delivered for the 2 split-surface themes. Before that fix this
   * block reported e.g. `burger-bold × crimson-silk: 1.03 < 4.5`: backdrop ink
   * painted on the theme's own card surface, in all 22 dish-card usages and in
   * the cart drawer.
   */
  it("card interiors never inherit a backdrop's page ink", () => {
    for (const t of MENU_THEMES) {
      for (const b of grounded) {
        const s = menuThemeStyle(t.id, null, b.id) as unknown as Record<string, string>;
        const where = `${t.id} × ${b.id}`;
        const checks: [string, number, number][] = [
          ["card ink on surface", ratio(s["--menu-surface-text"]!, t.vars.surface), 4.5],
          ["card soft ink on surface", ratio(s["--menu-surface-text-soft"]!, t.vars.surface), 4.5],
          ["card accent on surface", ratio(s["--menu-surface-accent"]!, t.vars.surface), 3.0],
          ["danger text on surface", ratio(s["--menu-danger"]!, t.vars.surface), 4.5],
          ["label on solid accent fill", ratio(s["--menu-on-accent"]!, s["--menu-accent"]!), 4.5],
        ];
        const fails = checks
          .filter(([, r, min]) => r < min)
          .map(([name, r, min]) => `${where} ${name}: ${r.toFixed(2)} < ${min}`);
        expect(fails, fails.join("; ")).toEqual([]);
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
